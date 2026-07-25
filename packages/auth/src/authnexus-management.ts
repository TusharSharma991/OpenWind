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
    const assertion = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: keyConfig.keyId })
      .setIssuedAt()
      .setIssuer(keyConfig.userId)
      .setSubject(keyConfig.userId)
      .setAudience(env.AUTHNEXUS_ISSUER)
      .setExpirationTime("1h")
      .sign(privateKey);

    const tokenUrl = `${env.AUTHNEXUS_ISSUER}/oauth/v2/token`;
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        scope: `openid urn:zitadel:iam:org:project:id:${env.AUTHNEXUS_PROJECT_ID}:aud`,
        assertion,
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

// ── Cache invalidation ────────────────────────────────────────────────────────

export function invalidateUserCache(): void {
  _assignmentsCache.clear();
  _userByIdCache.clear();
}
