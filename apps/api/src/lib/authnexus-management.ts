import { env } from "@platform/config";
import { logger } from "@platform/logger";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OrgUser {
  userId: string;
  email: string;
  displayName: string;
  loginName: string;
}

interface AuthNexusListUser {
  id: string;
  username: string;
  email: string;
  name?: string;
}

interface AuthNexusUserDetail {
  id: string;
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  state?: string;
}

// ── Role / user cache ─────────────────────────────────────────────────────────
// No service-account token to cache here — every call forwards the requesting
// user's own bearer token (AuthNexus's /api/admin/* endpoints require an admin
// session, so this is naturally scoped to admin-role callers by AuthNexus itself).

interface UserCacheEntry {
  users: OrgUser[];
  expiresAt: number;
}
// Values may be a settled entry or an in-flight Promise (single-flight guard).
const _usersCache = new Map<string, UserCacheEntry | Promise<OrgUser[]>>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const PAGE_LIMIT = 500;

function adminApiUrl(path: string): string {
  return `${env.AUTHNEXUS_ISSUER}${path}`;
}

// ── List project roles ────────────────────────────────────────────────────────
// AuthNexus has no dedicated "list project roles" endpoint (roles only appear
// embedded per-user under nexus_projects[].roles) — callers fall back to their
// own hardcoded default role list when this returns [].

export function listProjectRoles(): Promise<string[]> {
  return Promise.resolve([]);
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

  const cacheKey = orgId;
  const now = Date.now();
  const cached = _usersCache.get(cacheKey);
  // Return settled cache entry if still fresh
  if (cached && !(cached instanceof Promise) && now < cached.expiresAt)
    return cached.users;
  // Return in-flight promise if another caller already started the fetch
  if (cached instanceof Promise) return cached;

  const pending = _fetchOrgUsers(orgId, bearerToken, now, cacheKey);
  _usersCache.set(cacheKey, pending);
  return pending;
}

async function _fetchOrgUsers(
  orgId: string,
  bearerToken: string,
  now: number,
  cacheKey: string,
): Promise<OrgUser[]> {
  try {
    const url = adminApiUrl(
      `/api/admin/users?org_id=${encodeURIComponent(orgId)}&status=ACTIVE&limit=${PAGE_LIMIT}`,
    );
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${bearerToken}` },
    });

    if (!res.ok) {
      logger.warn({ status: res.status }, "AuthNexus list users failed");
      _usersCache.delete(cacheKey);
      return [];
    }

    const data = (await res.json()) as {
      users?: AuthNexusListUser[];
      total?: number;
    };

    if ((data.total ?? 0) > PAGE_LIMIT) {
      logger.warn(
        { orgId, total: data.total, fetched: PAGE_LIMIT },
        "listOrgUsers: result truncated — total exceeds page limit",
      );
    }

    const users: OrgUser[] = (data.users ?? [])
      .map((u) => ({
        userId: u.id,
        email: u.email,
        displayName: u.name ?? u.username,
        loginName: u.username,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    _usersCache.set(orgId, { users, expiresAt: now + CACHE_TTL_MS });
    return users;
  } catch (err) {
    logger.error({ err }, "Failed to list AuthNexus org users");
    // Evict so the next caller retries rather than getting a rejected/hung promise.
    _usersCache.delete(cacheKey);
    return [];
  }
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
  _usersCache.clear();
  _userByIdCache.clear();
}
