# 2026-09-08 — third-party API: assignedTo resolution, remark-as-comment, mandatory mention validation

Found via live testing against a real client org's production instance (assignedTo="JMV10730",
the acting person's own username, left the ticket unassigned with no error anywhere) and a
follow-up manual review of the comment-mentions design.

## Changes

1. **`assignedTo` resolution** (`apps/api/src/lib/resolve-org-member.ts`, new — renamed/generalized
   from `resolve-assigned-to.ts`): `POST /tickets` and `POST /tickets/:id/children` now resolve
   `assignedTo` against the org's real member list (`listOrgUsers`) before persisting, accepting
   either the raw AuthNexus user id or a username (`loginName`). Previously stored verbatim with
   zero validation — a username silently landed in `assigned_to`, matched no real user in
   admin-ui's own lookup (which keys strictly on `userId`), and the ticket just looked
   unassigned. Unresolvable values now 422 with
   `"Must be an existing org member's user id or username"`.

2. **`remark` posted as the ticket's first comment**: `tickets.ts`/`children.ts` now insert a
   `workflow_events`/`outboxEvents` row for `remark`, matching what admin-ui's own create flow
   already does — previously this only happened via the human UI, never via the third-party API,
   so an API-created ticket's remark was invisible in the Comments tab/timeline.

3. **Mandatory mention validation** (`comments.ts`): every identifier in `mentions[]` must now
   resolve to a real org member (userId, username, or email) or the whole comment is rejected
   with 422 (`"Not found: <identifier>"`), naming only the unresolved identifier — never a
   user list or suggestions. This is a **deliberate reversal** of the original design (ADR-012
   spec R5/R6), which resolved mentions asynchronously and never reported success/failure back,
   specifically to prevent using `mentions` as an org-member enumeration probe. That protection
   was consciously relaxed by explicit decision: the platform no longer treats "does this
   identifier belong to a real org member" as a secret worth protecting (same class of oracle
   GitHub's own @mention validation exposes), as long as the failure response itself never grows
   into a bigger leak (no suggestions, no partial user list).

## Security-review follow-up (same day)

Two findings from a scoped `security-reviewer` pass on this diff, both fixed before commit:

- `remark` was missing the same control-character guard (`FORBIDDEN_CHAR_PATTERN`) already
  applied to comment `text`, despite landing in the identical `workflow_events.metadata.text`
  sink via the remark-as-first-comment insert. Fixed by exporting the pattern from
  `validate-fields-payload.ts` and applying it to `remark` in both ticket/child create schemas.
- The `assignedTo`/`mentions` org-lookup (and the oracle it exposes) ran _before_ the
  resource-existence/access check in `children.ts`/`comments.ts`, letting the (accepted) oracle
  be probed via a nonexistent or inaccessible ticket id with no real authorization needed. Fixed
  by moving both resolution blocks to run only after `hasEntityAccess`/
  `hasEntityCommentAccessFull` passes.

## Outstanding

- `third-party-api-reference.md` (partner-facing, lives outside this repo) not yet updated for
  points 1-3 above.
- Not yet ported to the `tushar` git tree.
- Not yet deployed to the production server.
