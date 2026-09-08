# 2026-09-08 — mention-resolution crash on org members with no email

Found via live prod worker logs (`aw-worker`, `jmv.work.rokkalabs.com`), tracing why the
System Agent reply for an unresolvable comment mention (shipped earlier the same day) never
appeared on a live test ticket:

```
[09:39:33] ERROR mention-resolution: job failed
    attempt: 1
    err: "TypeError: Cannot read properties of undefined (reading 'toLowerCase')"
```

All 3 retry attempts failed identically, then `tag.resolution_failed` was audited — the job
crashed inside `resolveIdentifier` before ever reaching outcome 3, so the System Agent reply
(shipped earlier today) never got a chance to post.

## Root cause

`resolveIdentifier` (`apps/worker/src/mention-resolution-worker.ts`) called
`u.email.toLowerCase()` unguarded while scanning the org's user list. A real org member (a
machine/service account, most likely) has no `email` set at all — despite `OrgUser.email` being
typed as a required `string`. `Array.find`'s predicate runs against every entry until a match,
so this crashed the job for **any** mention identifier, valid or not, as long as such an account
existed anywhere in the org's member list — a type-safety gap (the type claimed a guarantee the
real API doesn't provide), not a logic bug in the matching itself.

## Fix

- `u.email?.toLowerCase()` in `resolveIdentifier`.
- Root-caused further: `OrgUser.email` and the underlying `AuthNexusAssignment.email`
  (`packages/auth/src/authnexus-management.ts`) retyped from `string` to `string?` (with a
  guarding comment) so the type system reflects reality instead of lying about a guarantee that
  doesn't hold — this is what let the same unguarded assumption exist in the first place.
- Propagated the widened type through every consumer: `apps/api/src/lib/ensure-user-refs.ts`
  (`||` → `??`), and admin-ui's `user-picker.tsx`/`users.tsx` (their own separate
  `UserOption`/`User` interfaces had the identical `email: string` + unguarded
  `.toLowerCase()` pattern client-side — not the reported crash, but the same latent risk,
  fixed defensively while already touching this).

## Verification

- `pnpm turbo run typecheck lint`: all 69 tasks clean (workspace-wide, since the type change
  rippled through several packages/apps)
- `mention-resolution-worker.test.ts`: 17 tests (1 new, reproducing the exact prod crash with a
  mocked emailless org member ahead of the real match in the list)
- `authnexus-management.test.ts`: 14 tests, unaffected
- Prove-It confirmed: reverting just the `?.` guard reproduces the identical
  `TypeError: Cannot read properties of undefined (reading 'toLowerCase')` in the new test
