## 2026-09-04 — Third-party ticket create/comment/subticket: origin-oidc-client-id RLS bug

**Session type:** Bug fix, found via manual testing against a local AuthNexus/NexusOW setup
**Branch:** `new`

### Context

Testing the third-party API end-to-end through OWTesterUI (a standalone tester in
`openWindTest/`, outside this repo) against a local AuthNexus-paired NexusOW deployment.
`GET /workflows` worked; `POST /tickets` consistently 401'd with `{"error":"UNAUTHORIZED",
"message":"Invalid API key"}` even with a freshly-minted, correctly-scoped, unrevoked key.

### Root cause

`resolveOriginOidcClientId` (`apps/api/src/lib/resolve-origin-oidc-client-id.ts`, added by the
origin-tagging work, `docs/specs/third-party-api-origin-tagging.md` Phase 2 T5/T6) queried
`api_keys` on the bare `db` client, deliberately bypassing `withTenantContext` — the function's
own comment argued this was safe since the lookup is by the key's own already-trusted row id, not
a search. But `api_keys` has RLS (`tenant_read`/`tenant_write`, gated on
`current_setting('app.tenant_id')`), and every real deployment connects as the non-superuser
`app_user` role (see `security.md` rule 1 / `withTenantContext`'s own "superusers bypass RLS by
default" comment). Without `app.tenant_id` set, the policy compares against `NULL` and the
`SELECT` silently returns zero rows — not an error, just nothing — so the function returned
`null` and the route rejected the request as if the key didn't exist. This affected all three
call sites: `tickets.ts`, `comments.ts`, `children.ts`.

Confirmed via `docker exec aw-backend printenv DATABASE_URL` (connects as `app_user`) and by
inspecting the RLS policy expressions directly (`pg_policy`/`pg_get_expr`).

### Why the existing isolation test never caught this

`third-party-ticket-create.isolation.test.ts` claims "RLS + app_user enforced (not mocked)", but
`apps/api/vitest.config.ts`'s default `DATABASE_URL` fallback connects as the Postgres superuser
`platform`, not `app_user` — superusers bypass RLS unconditionally regardless of policy, so the
bare-`db` bug was invisible in that test environment even though it reproduced on every real
`app_user`-connected deployment. Confirmed by reverting the fix and re-running the existing test:
it still passed.

### Fix

`resolveOriginOidcClientId` now takes `tenantId` and runs its query through
`withTenantContext` — the same pattern every other tenant-scoped query in the codebase already
uses. Added `apps/api/tests/isolation/resolve-origin-oidc-client-id.isolation.test.ts`, which
reproduces the actual RLS mechanics directly (`SET LOCAL ROLE app_user` without setting
`app.tenant_id`, inside a transaction on the shared test client) rather than relying on the
ambient connection's privilege level — confirmed failing on the pre-fix code and passing after.

### Verification

- `pnpm --filter @platform/api typecheck` — clean
- New regression test: 4/4 passed against the fix; the "resolves the key's oidcClientId" case
  fails against the reverted (pre-fix) code, confirming it actually catches the bug
- `third-party-ticket-create.isolation.test.ts`: 8/8 passed
- Live end-to-end via OWTesterUI against local AuthNexus/NexusOW: `POST /tickets` → `201`,
  correct `originOidcClientId`/`originPerformerUserId` in the response
- Full `apps/api` isolation suite: pre-existing flakiness unrelated to this change (different
  files fail on repeated runs — confirmed by reverting the fix and reproducing the same failures)
