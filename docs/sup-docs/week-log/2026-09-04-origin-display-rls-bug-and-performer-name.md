## 2026-09-04 — Origin-display app-name RLS bug + performer-name resolution

**Session type:** Bug fix, found via manual testing against a local AuthNexus/NexusOW setup
**Branch:** `new`

### Context

Follow-on from the same session's `origin-oidc-client-id` RLS fix (see the sibling week-log
entry). After that fix, ticket creation worked, but the ticket-detail page's provenance tag
showed `Created via Unknown application by 374487847148716035` — both halves wrong: the app
name should have shown the key's real `applicationName`, and the number is a raw AuthNexus user
id that should have resolved to a display name.

### Bug 1 — same RLS pattern as origin-oidc-client-id, in `resolve-origin-display.ts`

`lookupApplicationName`/`batchLookupApplicationNames` also queried `api_keys` on the bare `db`
client, bypassing RLS the same way `resolveOriginOidcClientId` did — see that fix's own
write-up for the full mechanism. Additionally, unlike `resolveOriginOidcClientId` (which looks up
by the key's own trusted row id), this lookup was keyed only by `oidc_client_id` with **no tenant
scope at all** — a minor tenant-isolation gap on its own, since `oidc_client_id` is only unique
among _active_ keys (see `api-key-mint-client-id-reclaim.isolation.test.ts`), so a revoked lineage
could in principle resolve against a different tenant's reclaimed client id.

Fixed by adding a `tenantId` parameter and running both queries through `withTenantContext`.
Updated all 5 call sites (`get.ts`, `list.ts`, `list-children.ts`, `list-workflow-events.ts`,
`my-tickets.ts`) to pass it through.

### Bug 2 (not actually a bug) — performer showing as a raw AuthNexus user id

`lookupPerformerDisplayName` calls AuthNexus's `/api/admin/users/:id` via `getUserById`, which
needs _some_ bearer token — either a caller-forwarded one or a service-account token minted from
`AUTHNEXUS_SERVICE_ACCOUNT_KEY`. Neither was being supplied: `resolve-origin-display.ts` never
threaded a bearer token through, and this local `.env` has no service-account key configured.

Rather than requiring a new AuthNexus service-account credential (a real secret that needs minting
from AuthNexus's own admin console), reused the pattern already shipped for `org-view.ts`/
`team-member-view.ts` — both forward the _requesting user's own_ bearer token to `getUserById`
for this exact same admin-API call, and that's an existing, working, `requireAuth()`-only
(no special role) code path. Threaded an optional `bearerToken` parameter through
`resolveOriginDisplay`/`lookupPerformerDisplayName`/`batchLookupPerformerNames`, and updated all 5
call sites to extract `c.req.header("Authorization")?.slice(7)` and pass it along, same as
`list-workflow-events.ts` already did for its own separate actor-name resolution.

### Verification

- `pnpm --filter @platform/api typecheck` / `lint` — clean
- New regression test (`resolve-origin-display.isolation.test.ts`): 4/4 passed against the fix;
  fails against the reverted (pre-fix) code (a `TypeError` from the changed call signature,
  confirming the test actually exercises post-fix behavior)
- `pnpm --filter @platform/api exec vitest run src/routes/entities tests/isolation/resolve-origin-display.isolation.test.ts tests/isolation/resolve-origin-oidc-client-id.isolation.test.ts tests/isolation/third-party-ticket-create.isolation.test.ts`: 215/215 passed
- Live verification of the app-name fix confirmed via browser (ticket detail page showed the
  correct application name). Live verification of the performer-name fix pending a fresh login
  after a Docker Desktop restart interrupted this session — not yet re-confirmed in-browser as of
  this write-up.

### Also updated (non-code)

`third-party-api-reference.md` (the partner-facing API doc, lives outside this repo) — corrected
stale/inaccurate guidance (it said to send the ID token; the verified working flow uses the
access token), replaced vague "OpenWind's own identity provider" language with concrete AuthNexus
endpoint shapes and a real example token, and documented the `origin` field's shape and fallback
behavior for third-party integrators who'll see it on ticket reads.
