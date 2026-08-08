import { createPrivateKey } from "node:crypto";
import { importPKCS8, SignJWT } from "jose";
import { z } from "zod";
import { env } from "@platform/config";
import { logger } from "@platform/logger";

// Lives here (not apps/api/src/lib) so apps/worker can reach it too — apps/*
// may only depend on packages/*, never on another app. apps/api's old path
// re-exports from here unchanged so existing call sites and their
// vi.mock("../../lib/authnexus-management.js", ...) test mocks keep working.

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OrgUser {
  userId: string;
  email: string;
  displayName: string;
  loginName: string;
}

interface AuthNexusAssignment {
  userId: string;
  userName: string;
  firstName?: string;
  lastName?: string;
  email: string;
  displayName?: string;
  preferredLoginName?: string;
  roleKeys: string[];
  state: string;
}

interface AuthNexusUserDetail {
  id: string;
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  state?: string;
}

const ServiceAccountKeySchema = z.object({
  type: z.string(),
  keyId: z.string(),
  key: z.string(),
  userId: z.string(),
  expirationDate: z.string().optional(),
});
type ServiceAccountKey = z.infer<typeof ServiceAccountKeySchema>;

function adminApiUrl(path: string): string {
  return `${env.AUTHNEXUS_ISSUER}${path}`;
}

// ── M2M service-account token (background/worker context) ─────────────────────
// A per-request bearer token is only available inside an HTTP handler — a
// background worker (e.g. apps/worker's notification-outbound-worker) has no
// user session to forward, so it mints its own token via the same JWT-bearer
// grant AuthNexus's user login flow uses, just as a dedicated machine user
// instead of a human. AuthNexus wraps Zitadel, so this is the identical
// grant/key-format Zitadel itself uses — only the issuer URL and project id
// differ. AUTHNEXUS_SERVICE_ACCOUNT_KEY is optional: callers without a
// bearerToken AND without this configured simply get [] / null, not a crash.

let _cachedServiceToken: string | null = null;
let _serviceTokenExpiresAt = 0;

function parseServiceAccountKey(): ServiceAccountKey | null {
  const raw = env.AUTHNEXUS_SERVICE_ACCOUNT_KEY;
  if (!raw) return null;
  try {
    return ServiceAccountKeySchema.parse(JSON.parse(raw));
  } catch {
    logger.error(
      {},
      "authnexus-management: AUTHNEXUS_SERVICE_ACCOUNT_KEY is not valid service-account JSON",
    );
    return null;
  }
}

async function getServiceAccountToken(): Promise<string | null> {
  const now = Date.now();
  if (_cachedServiceToken && now < _serviceTokenExpiresAt - 30_000) {
    return _cachedServiceToken;
  }

  const keyConfig = parseServiceAccountKey();
  if (!keyConfig) return null;

  try {
    // AuthNexus (like Zitadel) may hand back PKCS#1 or PKCS#8 keys —
    // importPKCS8 only accepts PKCS#8, so normalise via Node's
    // createPrivateKey, which accepts both.
    const exportedKey = keyConfig.key.includes("BEGIN PRIVATE KEY")
      ? keyConfig.key
      : createPrivateKey(keyConfig.key).export({
          type: "pkcs8",
          format: "pem",
        });
    const keyPem =
      typeof exportedKey === "string"
        ? exportedKey
        : (exportedKey as Buffer).toString("utf8");

    const privateKey = await importPKCS8(keyPem, "RS256");
    // Assertion aud must target Zitadel itself (the server that actually
    // verifies this signature), not AUTHNEXUS_ISSUER (the AuthNexus API
    // wrapper's own public origin) — see AUTHNEXUS_ZITADEL_AUD's doc comment
    // in packages/config/src/env.ts for how this was confirmed.
    const assertion = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: keyConfig.keyId })
      .setIssuedAt()
      .setIssuer(keyConfig.userId)
      .setSubject(keyConfig.userId)
      .setAudience(env.AUTHNEXUS_ZITADEL_AUD ?? env.AUTHNEXUS_ISSUER)
      .setExpirationTime("1h")
      .sign(privateKey);

    const tokenUrl = `${env.AUTHNEXUS_ISSUER}/api/v1/auth/m2m`;
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        scope: `openid urn:zitadel:iam:org:project:id:${env.AUTHNEXUS_PROJECT_ID}:aud`,
        assertion,
        org_id: env.AUTHNEXUS_ORG_ID ?? "",
      }).toString(),
    });

    if (!res.ok) {
      logger.error(
        { status: res.status },
        "authnexus-management: service-account token exchange failed",
      );
      return null;
    }

    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    _cachedServiceToken = data.access_token;
    _serviceTokenExpiresAt = now + data.expires_in * 1000;
    return _cachedServiceToken;
  } catch (err) {
    logger.error(
      { err },
      "authnexus-management: failed to obtain service-account token",
    );
    return null;
  }
}

// ── Assignment cache ──────────────────────────────────────────────────────────
// listOrgUsers and listProjectRoles both derive from the same per-org
// project-assignments fetch, so they share one cache keyed by orgId.

interface AssignmentCacheEntry {
  assignments: AuthNexusAssignment[];
  expiresAt: number;
}
// Values may be a settled entry or an in-flight Promise (single-flight guard).
const _assignmentsCache = new Map<
  string,
  AssignmentCacheEntry | Promise<AuthNexusAssignment[]>
>();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getActiveAssignments(
  orgId: string,
  bearerToken: string,
): Promise<AuthNexusAssignment[]> {
  const now = Date.now();
  const cached = _assignmentsCache.get(orgId);
  if (cached && !(cached instanceof Promise) && now < cached.expiresAt)
    return cached.assignments;
  if (cached instanceof Promise) return cached;

  const pending = _fetchAssignments(orgId, bearerToken, now);
  _assignmentsCache.set(orgId, pending);
  return pending;
}

async function _fetchAssignments(
  orgId: string,
  bearerToken: string,
  now: number,
): Promise<AuthNexusAssignment[]> {
  try {
    const url = adminApiUrl(
      `/api/admin/projects/${encodeURIComponent(env.AUTHNEXUS_PROJECT_ID)}/assignments?org_id=${encodeURIComponent(orgId)}`,
    );
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${bearerToken}` },
    });

    if (!res.ok) {
      logger.warn({ status: res.status }, "AuthNexus list assignments failed");
      _assignmentsCache.delete(orgId);
      return [];
    }

    const data = (await res.json()) as AuthNexusAssignment[];
    const active = data.filter((a) => a.state === "USER_GRANT_STATE_ACTIVE");
    _assignmentsCache.set(orgId, {
      assignments: active,
      expiresAt: now + CACHE_TTL_MS,
    });
    return active;
  } catch (err) {
    logger.error({ err }, "Failed to list AuthNexus project assignments");
    _assignmentsCache.delete(orgId);
    return [];
  }
}

function assignmentToOrgUser(a: AuthNexusAssignment): OrgUser {
  const nameParts = [a.firstName, a.lastName].filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );
  const fullName = nameParts.length > 0 ? nameParts.join(" ") : undefined;
  return {
    userId: a.userId,
    email: a.email,
    displayName: a.displayName ?? fullName ?? a.userName,
    loginName: a.preferredLoginName ?? a.userName,
  };
}

// ── List project roles ────────────────────────────────────────────────────────
// Derived from the same project-assignments endpoint as listOrgUsers — the
// union of every active grant's roleKeys for this org, rather than a static
// list. Callers fall back to their own hardcoded defaults when this returns [].

export async function listProjectRoles(
  orgId: string,
  bearerToken: string,
): Promise<string[]> {
  if (!orgId) return [];
  const assignments = await getActiveAssignments(orgId, bearerToken);
  return [...new Set(assignments.flatMap((a) => a.roleKeys))];
}

// ── List org users ────────────────────────────────────────────────────────────

// orgId is required (not optional) — callers must guard at the call site
// (`orgId ? listOrgUsers(orgId, token) : Promise.resolve([])`) rather than this
// function silently falling through to an unfiltered instance-wide query on a
// missing orgId.
export async function listOrgUsers(
  orgId: string,
  bearerToken: string,
): Promise<OrgUser[]> {
  if (!orgId) {
    logger.warn(
      {},
      "listOrgUsers called without an orgId — refusing to fall through to an unfiltered query",
    );
    return [];
  }

  const assignments = await getActiveAssignments(orgId, bearerToken);
  return assignments
    .map(assignmentToOrgUser)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

// ── List user roles by user id ────────────────────────────────────────────────
// Derived from the same project-assignments endpoint as listOrgUsers/
// listProjectRoles — a map of every active grant's roleKeys, keyed by userId.
// Feeds (a) the users page's Roles column and role-based filtering, and (b)
// listUserIdsWithRole below.

export async function listUserRolesByUserId(
  orgId: string,
  bearerToken: string,
): Promise<Map<string, string[]>> {
  if (!orgId) return new Map();
  const assignments = await getActiveAssignments(orgId, bearerToken);
  const rolesByUserId = new Map<string, string[]>();
  for (const a of assignments) {
    const existing = rolesByUserId.get(a.userId) ?? [];
    rolesByUserId.set(
      a.userId,
      Array.from(new Set([...existing, ...a.roleKeys])),
    );
  }
  return rolesByUserId;
}

export async function listUserIdsWithRole(
  orgId: string,
  roleKey: string,
  bearerToken: string,
): Promise<Set<string>> {
  const rolesByUserId = await listUserRolesByUserId(orgId, bearerToken);
  const userIds = new Set<string>();
  for (const [userId, roles] of rolesByUserId) {
    if (roles.includes(roleKey)) userIds.add(userId);
  }
  return userIds;
}

// ── Get single user by ID ─────────────────────────────────────────────────────

const _userByIdCache = new Map<
  string,
  { user: OrgUser | null; expiresAt: number }
>();

// bearerToken is optional — an HTTP-handler caller forwards the requesting
// user's own token; a background worker with no user session (e.g. the
// notification outbound worker resolving a recipient's email) omits it and
// this mints its own service-account token instead. Returns null (not a
// crash) if neither a token is provided nor AUTHNEXUS_SERVICE_ACCOUNT_KEY is
// configured.
export async function getUserById(
  userId: string,
  bearerToken?: string,
): Promise<OrgUser | null> {
  const now = Date.now();
  const cached = _userByIdCache.get(userId);
  if (cached && now < cached.expiresAt) return cached.user;

  const token = bearerToken ?? (await getServiceAccountToken());
  if (!token) return null;

  try {
    const url = adminApiUrl(`/api/admin/users/${encodeURIComponent(userId)}`);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      _userByIdCache.set(userId, { user: null, expiresAt: now + CACHE_TTL_MS });
      return null;
    }

    const u = (await res.json()) as AuthNexusUserDetail;
    const nameParts = [u.firstName, u.lastName].filter(
      (s): s is string => typeof s === "string" && s.length > 0,
    );
    const fullName = nameParts.length > 0 ? nameParts.join(" ") : undefined;
    const displayName = fullName ?? u.username;
    const orgUser: OrgUser = {
      userId: u.id,
      email: u.email,
      displayName,
      loginName: u.username,
    };
    _userByIdCache.set(userId, {
      user: orgUser,
      expiresAt: now + CACHE_TTL_MS,
    });
    return orgUser;
  } catch {
    return null;
  }
}

// ── Org hierarchy (My Org View — docs/specs/my-org-view.md) ────────────────────
// AuthNexus-only: Zitadel (core's identity provider) has no manager/report-chain
// data. This is the sole call site for /connections — keep it that way so a
// contract change only needs updating here (see spec §T's "unstable API" note).

interface NestedReportNode {
  userId: string;
  children?: NestedReportNode[];
}

interface OrgConnectionsResponse {
  dataIncomplete: boolean;
  user: { userId: string; wasCycleMember?: boolean } | null;
  descendants: {
    directReportsCount: number;
    totalReportsCount: number;
    reports: NestedReportNode[];
  };
}

export interface OrgSubordinates {
  ids: string[];
  hasReports: boolean;
  status: "ok" | "unavailable";
}

// Flattens the nested reports tree (any depth — AuthNexus confirmed no depth
// cap in practice) into a flat list of userIds for
// resolveUserScopedEntityIds(tenantId, [userId, ...ids]).
function flattenReports(nodes: NestedReportNode[]): string[] {
  const ids: string[] = [];
  const stack = [...nodes];
  while (stack.length > 0) {
    // non-null assertion safe: loop condition guarantees stack.length > 0
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const node = stack.pop()!;
    ids.push(node.userId);
    if (node.children && node.children.length > 0) stack.push(...node.children);
  }
  return ids;
}

interface OrgConnectionsCacheEntry extends OrgSubordinates {
  expiresAt: number;
}
const _orgConnectionsCache = new Map<
  string,
  OrgConnectionsCacheEntry | Promise<OrgSubordinates>
>();
const ORG_CONNECTIONS_CACHE_TTL_MS = 5 * 60 * 1000;

// dataIncomplete:true can mean "transient, will self-heal" or "permanently
// excluded" (non-human account) — AuthNexus confirmed the response can't tell
// these apart. Track how long a key has been seeing dataIncomplete; once past
// budget, stop calling AuthNexus for it at all (until invalidateUserCache()).
interface IncompleteTracker {
  firstSeenAt: number;
  permanentlyUnavailable: boolean;
}
const _orgIncompleteTracker = new Map<string, IncompleteTracker>();
const DATA_INCOMPLETE_BUDGET_MS = 20 * 60 * 1000;

// bearerToken is the CALLER'S OWN forwarded token, never a service-account
// token minted on someone else's behalf — org-view.ts must always pass the
// requesting user's own userId here (see spec §V: no client-supplied target
// userId), and AuthNexus enforces no per-user authorization beyond the org
// boundary, so this function must never be called with an arbitrary userId.
export async function getSubordinateIds(
  orgId: string,
  userId: string,
  bearerToken: string,
): Promise<OrgSubordinates> {
  if (!orgId || !userId) {
    return { ids: [], hasReports: false, status: "unavailable" };
  }

  const cacheKey = `${orgId}:${userId}`;
  const cached = _orgConnectionsCache.get(cacheKey);
  if (cached && !(cached instanceof Promise) && Date.now() < cached.expiresAt) {
    return {
      ids: cached.ids,
      hasReports: cached.hasReports,
      status: cached.status,
    };
  }
  if (cached instanceof Promise) return cached;

  const pending = _fetchSubordinateIds(orgId, userId, bearerToken, cacheKey);
  _orgConnectionsCache.set(cacheKey, pending);
  return pending;
}

async function _fetchSubordinateIds(
  orgId: string,
  userId: string,
  bearerToken: string,
  cacheKey: string,
): Promise<OrgSubordinates> {
  const tracker = _orgIncompleteTracker.get(cacheKey);
  if (tracker?.permanentlyUnavailable) {
    _orgConnectionsCache.delete(cacheKey);
    return { ids: [], hasReports: false, status: "unavailable" };
  }

  try {
    const url = adminApiUrl(
      `/api/admin/orgs/${encodeURIComponent(orgId)}/users/${encodeURIComponent(userId)}/connections?detail=ids`,
    );
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${bearerToken}` },
    });

    if (!res.ok) {
      logger.warn(
        { status: res.status, orgId, userId },
        "AuthNexus org-connections fetch failed",
      );
      _orgConnectionsCache.delete(cacheKey);
      return { ids: [], hasReports: false, status: "unavailable" };
    }

    const data = (await res.json()) as OrgConnectionsResponse;

    if (data.dataIncomplete) {
      const now = Date.now();
      const firstSeenAt = tracker?.firstSeenAt ?? now;
      const permanentlyUnavailable =
        now - firstSeenAt >= DATA_INCOMPLETE_BUDGET_MS;
      _orgIncompleteTracker.set(cacheKey, {
        firstSeenAt,
        permanentlyUnavailable,
      });
      _orgConnectionsCache.delete(cacheKey);
      return { ids: [], hasReports: false, status: "unavailable" };
    }

    // Resolved — clear any prior incomplete tracking for this key.
    _orgIncompleteTracker.delete(cacheKey);

    if (data.user?.wasCycleMember) {
      // Data-quality issue in AuthNexus's source HR data (a manager-reference
      // cycle got auto-corrected upstream) — log for follow-up, never surface
      // to the end user (spec §V: the tree is still usable, just structurally
      // wrong for the affected nodes).
      logger.warn(
        { orgId, userId },
        "AuthNexus org-connections: user was a cycle member (upstream data-quality issue)",
      );
    }

    const result: OrgSubordinates = {
      ids: flattenReports(data.descendants.reports),
      hasReports: data.descendants.directReportsCount > 0,
      status: "ok",
    };
    _orgConnectionsCache.set(cacheKey, {
      ...result,
      expiresAt: Date.now() + ORG_CONNECTIONS_CACHE_TTL_MS,
    });
    return result;
  } catch (err) {
    logger.error(
      { err, orgId, userId },
      "Failed to fetch AuthNexus org connections",
    );
    _orgConnectionsCache.delete(cacheKey);
    return { ids: [], hasReports: false, status: "unavailable" };
  }
}

// ── Cache invalidation ────────────────────────────────────────────────────────

export function invalidateUserCache(): void {
  _assignmentsCache.clear();
  _userByIdCache.clear();
  _orgConnectionsCache.clear();
  _orgIncompleteTracker.clear();
}
