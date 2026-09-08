import { listOrgUsers } from "./authnexus-management.js";

export type OrgMemberResolution = { ok: true; userId: string } | { ok: false };

/**
 * Resolves a caller-supplied identifier to the canonical AuthNexus user id
 * every other part of the platform expects wherever a user reference is
 * stored (e.g. entity_instances.assigned_to -- admin-ui's AssignDropdown
 * matches strictly against a user's numeric `userId`, never their
 * username).
 *
 * Accepts a raw userId (already-correct callers keep working unchanged), a
 * username/login name (`loginName` on the org-users list), or -- when
 * `matchEmail` is set -- an email address too (the third-party comment
 * `mentions` field has always documented email as an accepted identifier
 * shape, per third-party-api-reference.md §5.4). Humans naturally remember
 * usernames/emails, not opaque numeric ids.
 *
 * Originally added for `assignedTo`, which was previously stored verbatim
 * with zero validation -- a username silently landed in `assigned_to`,
 * matched no real user in the UI's own lookup, and the ticket simply looked
 * "unassigned" with no error surfaced anywhere (found via manual testing
 * against a real client org's production instance). Reused for comment
 * `mentions` validation for the same reason (2026-09-07): an unresolvable
 * @mention previously succeeded silently (async, never reported back, by
 * deliberate original design -- see comments.ts's own history/ADR-012 spec
 * R5/R6 -- specifically to prevent using the mentions list as an org-
 * member enumeration probe). That protection was deliberately relaxed by a
 * conscious decision: the caller now gets a plain "not found" error with no
 * user list or suggestions attached, so the failure signal itself doesn't
 * leak anything beyond "this one identifier didn't match."
 *
 * Returns { ok: false } for anything that resolves to none of the above --
 * callers should reject with 422 rather than silently persisting/using an
 * unresolvable value.
 */
export async function resolveOrgMemberUserId(
  orgId: string | undefined,
  bearerToken: string,
  value: string,
  opts?: { matchEmail?: boolean },
): Promise<OrgMemberResolution> {
  if (!orgId) return { ok: false };
  const users = await listOrgUsers(orgId, bearerToken);
  const match = users.find(
    (u) =>
      u.userId === value ||
      u.loginName === value ||
      (opts?.matchEmail && u.email === value),
  );
  return match ? { ok: true, userId: match.userId } : { ok: false };
}
