# 2026-09-08 — comment mentions now resolve by username, not just userId/email

Found during local end-to-end testing of the System Agent reply feature (same day): comment
`mentions[]` only matched a real org member's `userId` or `email` (the original ADR-012 spec R4
wording), never their username (`loginName`) — but a real person composing an @mention naturally
has a username/name on hand, not an opaque userId, matching how admin-ui's own @mention picker
already works.

## Fix

`apps/worker/src/mention-resolution-worker.ts`'s `resolveIdentifier` now also matches
`loginName`, alongside the existing `userId`/`email` match (same three-way match
`resolveOrgMemberUserId` already uses for `assignedTo` resolution — this was the one remaining
inconsistency between the two). `comments.ts`'s schema comment updated to match.

## Verification

- `pnpm --filter @platform/worker typecheck/lint`: clean
- `mention-resolution-worker.test.ts`: 16/16 pass, new test added for username resolution,
  Prove-It confirmed (fails without the fix)
- Manually verified locally via OWTesterUI against the rebuilt `aw-worker`/`aw-backend`
  containers: a real org member's username, previously reported as "not found" by the System
  Agent reply, now resolves silently (no reply posted) as expected.
