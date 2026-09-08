# 2026-09-08 — third-party API: System Agent reply + username-mention resolution (ported from the AuthNexus-paired fork)

Follow-up to the earlier same-day port (`5c982ba3`, assignedTo resolution + mandatory mention
validation), which shipped a synchronous 422 whenever `assignedTo` or a comment `mentions[]`
entry failed to resolve. That 422 is itself a fast, scriptable "does this org member exist"
oracle — the sibling AuthNexus fork's own security review caught this the same day, and reversed
the design. This commit ports that reversal here.

## The fix: uniform response + async notification, never a synchronous answer

- `assignedTo`/`mentions[]` resolution failures no longer 422. The ticket/sub-ticket/comment is
  always created/accepted (`assignedTo` ends up `null` if unresolved; an unresolved mention just
  doesn't get its grant/notification wired, the original pre-422 design).
- Instead, a **"System Agent" comment** notifies the person who submitted the bad value, riding
  the platform's existing notification pipeline:
  - For comment mentions: replies to the comment that carried the bad mention (`comment.replied`
    path), same as the sibling fork.
  - For `assignedTo` on ticket/sub-ticket create: **this tree has no `remark` field** (the
    mandatory-baseline-fields feature that introduced `remark`/`dueDate` on the sibling fork was
    never ported here), so there's no host comment to reply to. Instead posts a **top-level**
    system comment and notifies via the existing `comment.mentioned` path — same notification
    outcome (in-app + email to the creator), no reply target required.
- `apps/api/src/lib/post-system-comment.ts` (new) — shared helper for `tickets.ts`/`children.ts`.
- `apps/worker/src/mention-resolution-worker.ts`'s outcome-3 branch (unresolvable/non-tenant-user
  mention) posts the same kind of reply inline.

## Also: mentions now resolve by username, not just userId/email

Found during the sibling fork's own local end-to-end testing: `resolveIdentifier` only matched a
real org member's `userId` or `email`, never their username (`loginName`) — but a real person
composing an @mention naturally has a username on hand. `resolveIdentifier` now also matches
`loginName`, alongside the existing match, same three-way match `resolveOrgMemberUserId` already
used for `assignedTo`.

## Verification

- `pnpm --filter @platform/api typecheck/lint`, `pnpm --filter @platform/worker typecheck/lint`:
  clean
- `third-party-ticket-create.isolation.test.ts` / `third-party-subticket-create.isolation.test.ts`
  / `third-party-comment-mentions-response-uniformity.isolation.test.ts` (restored, supersedes the
  deleted `third-party-comment-mention-validation.isolation.test.ts`): 33 tests, all green
- `mention-resolution-worker.test.ts`: 16 tests, all green (2 new: username resolution, System
  Agent reply on outcome 3)
- Prove-It confirmed for every new/changed test via `git stash`
