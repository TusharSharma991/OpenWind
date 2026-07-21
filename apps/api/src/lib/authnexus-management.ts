import { env } from "@platform/config";
import { logger } from "@platform/logger";

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

// ── Assignment cache ──────────────────────────────────────────────────────────
// No service-account token to cache here — every call forwards the requesting
// user's own bearer token (AuthNexus's /api/admin/* endpoints require an admin
// session, so this is naturally scoped to admin-role callers by AuthNexus itself).
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

function adminApiUrl(path: string): string {
  return `${env.AUTHNEXUS_ISSUER}${path}`;
}

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

export async function getUserById(
  userId: string,
  bearerToken: string,
): Promise<OrgUser | null> {
  const now = Date.now();
  const cached = _userByIdCache.get(userId);
  if (cached && now < cached.expiresAt) return cached.user;

  try {
    const url = adminApiUrl(`/api/admin/users/${encodeURIComponent(userId)}`);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${bearerToken}` },
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
