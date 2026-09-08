# 2026-09-08 — third-party API: assignedTo resolution + mandatory mention validation (ported from the AuthNexus-paired fork)

Ported from a sibling fork's fixes (found via live testing against a real client org's
production instance there), adapted to this tree's actual schema/identity provider.

## Changes

1. **`assignedTo` resolution** (`apps/api/src/lib/resolve-org-member.ts`, new): `POST /tickets`
   and `POST /tickets/:id/children` now resolve `assignedTo` (still optional on this tree's
   schema, unlike the sibling fork's mandatory-baseline-fields feature, which was **not**
   ported here — see "Not ported" below) against the org's real member list (Zitadel's
   `listOrgUsers`) when a value is supplied, accepting either the raw Zitadel user id or a
   username (`loginName`). Previously stored verbatim with zero validation. Unresolvable
   values now 422 with `"Must be an existing org member's user id or username"`.

2. **Mandatory mention validation** (`comments.ts`): every identifier in `mentions[]` must now
   resolve to a real org member (userId, username, or email) or the whole comment is rejected
   with 422 (`"Not found: <identifier>"`), naming only the unresolved identifier. Deliberate
   reversal of the original async-only design (ADR-012 spec R5/R6) — see the sibling fork's own
   write-up for the full rationale/decision history. The async `mentionResolutionQueue` enqueue
   is unchanged and still runs for the actual notification/grant side effects; only the
   accept/reject decision is now synchronous.

Both resolution blocks run **after** the resource access check (`hasEntityAccess`/
`hasEntityCommentAccessFull`), not before — the sibling fork's own security review found that
ordering mattered (an org-lookup before the access check lets the accepted
real-org-member-existence oracle be probed via a nonexistent or inaccessible ticket id with no
authorization needed), so this port applies that ordering from the start rather than
reproducing then re-fixing the same issue.

## Not ported

- **remark-as-first-comment**: the sibling fork also posts `remark` as the ticket's first
  comment on create. This tree's `CreateThirdPartyTicketSchema`/`CreateThirdPartyChildSchema`
  have no `remark` or `dueDate` field at all (the sibling fork's mandatory-baseline-fields
  feature, which introduced those fields, was explicitly not ported to this tree since its own
  admin-ui doesn't have that convention). Nothing to wire up until/unless that decision changes.
- The sibling fork's control-character guard fix on `remark` is likewise not applicable here for
  the same reason (no `remark` field exists).

## Test coverage

- `apps/api/tests/isolation/third-party-ticket-create.isolation.test.ts` — added `listOrgUsers`
  mock + 2 tests (username resolves to canonical id, unresolvable assignee 422s)
- `apps/api/tests/isolation/third-party-subticket-create.isolation.test.ts` — same
- `apps/api/tests/isolation/third-party-comment-mention-validation.isolation.test.ts` — new,
  5 tests, replaces the now-obsolete
  `third-party-comment-mentions-response-uniformity.isolation.test.ts` (deleted — its whole
  premise was the async-only design this change reverses)

## Verification

- `pnpm --filter @platform/api typecheck` / `lint`: clean
- Targeted isolation suites (ticket-create, subticket-create, comment-mention-validation,
  comment-post): 4 files, 36 tests, all green
- Confirmed 3 pre-existing, unrelated failures (`third-party-ticket-detail`,
  `third-party-transition`, `third-party-misuse-alerts`) reproduce identically on the
  unmodified tree via `git stash` — not caused by this change
