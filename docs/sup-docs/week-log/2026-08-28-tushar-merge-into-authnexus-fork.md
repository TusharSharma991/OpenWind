## 2026-08-28 — Synced `tushar` (192 commits, ADR-012 Phases A-G + idempotency-keys) into the AuthNexus fork

**Session type:** Cross-fork merge (`origin/tushar` → `new`, the AuthNexus-based OpenWind fork)
**Branch:** `new`

### Context

This fork (`new`) swapped Zitadel for AuthNexus as the OIDC provider (`f3c26d52`). `tushar` had
diverged 192 commits ahead on top of a still-Zitadel-based ancestor, carrying the ADR-012
third-party ticket API (Phases A-G), idempotency-key support, the third-party transition
role-mapping fix, and 32+ new migrations. Followed
`work docs/OW/zitaToOw.md` (the cross-fork pull guide) and this repo's
`.claude/skills/authnexus-pull-guard/SKILL.md`.

### Auth-layer adaptations (the actual point of the pull guide)

- **`packages/auth/src/dual-identity.ts`** (new file from `tushar`, `requireActingPerson`
  middleware, ADR-012 Phase B): hardcoded `claims["urn:zitadel:iam:user:resourceowner:id"]` with
  no fallback — changed to `claims.org_id`, matching how `jwks.ts` already resolves org for this
  fork's flat AuthNexus claim shape.
- **`requireIntrospection()`** stripped from every route `tushar` wired it into (execute-transition,
  entity-type create/delete, entity delete, api-keys update/emergency-rotate, and their tests) —
  AuthNexus has no introspection endpoint; this fork already made that call when it removed
  `introspection.ts` at fork creation. Left `requireAuth()`/`requireRole()` as the enforcement.
- **`packages/auth/src/jwks.ts`**: kept `tushar`'s `verifyJwt`/`verifyJwtWithAudience` refactor
  (adds the acting-person audience check + `JWT_MAX_TOKEN_AGE_SECONDS`, default 900s), rewired to
  `env.AUTHNEXUS_ISSUER`/`env.AUTHNEXUS_AUDIENCE`.
- **`packages/auth/src/authnexus-management.ts`**: merge surfaced a real bug — some functions
  required a `bearerToken` that `apps/worker/src/mention-resolution-worker.ts` (a background job,
  no HTTP request to source a token from) had no way to supply. Made `bearerToken` optional with
  service-account fallback.
- **`docker-compose.yml` / `packages/config/src/env.ts`**: kept `openwind-authnexus` project name,
  `aw-*` container prefixes, 10406-10411 port range; merged in `tushar`'s unrelated new
  services/vars.

### Migration renumbering bug (found + fixed post-merge)

Both branches independently authored migrations 0053-0084; the merge resolution deduplicated 9
byte-identical files and renumbered `tushar`'s 22 unique migrations to 0064-0086, rebuilding
`packages/db/migrations/meta/_journal.json` by hand. Validating against a live `aw-database`
surfaced a real bug in that rebuild: drizzle-kit's Postgres migrator (`pg-core/dialect.ts`)
applies a journal entry only if its `when` timestamp exceeds the **single max** `created_at`
already recorded in `__drizzle_migrations` — it is not a per-entry hash check. Several
renumbered entries (`0044_platform_settings`, `0053_outbox_sweeper_role`,
`0062_entity_instances_remark`, `0064_plugin_system`, `0065_connector_definitions_grants_fix`,
`0066_app_user_default_grants_revoke`, `0067_tenants_column_scoped_update`) had inherited their
original, older authored-timestamp `when` values, which fell below this fork's already-recorded
max — so `pnpm db:migrate` silently skipped them forever, reporting "All migrations applied
successfully" while `plugin_definitions`/`installed_plugins` never actually got created.

Fix: audited which of the 7 skipped migrations' effects already existed in the live DB (3 did:
`platform_settings`, the `outbox_sweeper` role, `entity_instances.remark` — left their `when`
unchanged, permanently below threshold, matching reality) versus which didn't (4 needed to run:
`plugin_system`'s tables, and 3 real security-hardening REVOKEs on
`connector_definitions`/`modules`/`tenants`/`platform_settings`/`admin_audit_log` that were
confirmed still-unapplied via `\dp`) — bumped only those 4 above the current max, re-ran
`pnpm db:migrate`, confirmed via `\dt`/`\dp` that `plugin_definitions`, `installed_plugins`,
`plugin_errors` now exist and `connector_definitions`'s over-grant to `app_user` is now correctly
narrowed to read-only.

### Verification

- `pnpm typecheck`: PASS
- `pnpm lint`: PASS
- `pnpm db:migrate` against live `aw-database`: PASS (87/87 migrations recorded, spot-checked
  table/grant state directly)
- `pnpm test`: 253/256 passing. The 3 remaining `apps/worker` isolation-test failures are a
  pre-existing, already-documented environment divergence — migration `0065`'s own comment notes
  the `REVOKE INSERT/DELETE ON tenants FROM app_user` hardening (migration `0066`) has no effect
  against CI's `platform_test` database (migrated via the `platform` superuser, so the
  default-privileges auto-grant this REVOKE targets never fires there), but _does_ apply against
  this fork's dev `aw-database` (migrated via `migration_user`, matching production topology) —
  so isolation-test fixtures that `db.insert(tenants, …)` directly as `app_user` (a
  pre-existing, widespread pattern — 51 files) fail here but pass in CI. Confirmed not
  introduced by this merge; tracked as CI/dev migration-role divergence, explicitly flagged as
  out-of-scope by migration `0065` itself.
- `pnpm test:isolation`: not run in full, for the same reason above — would surface the same
  known divergence broadly rather than anything new.

### Container boot verification

Rebuilt and restarted `aw-backend`/`aw-frontend`/`aw-worker` against the migrated `aw-database`.
Worker boots clean (outbox poller, SLA/alert/due-date schedulers, connector-poll-scheduler, all
started). API boots and `GET /health` returns 200. One non-fatal startup error found:
`module-service.ts`'s `seedRegistry()` upserts into `modules` using the app's normal runtime
(`app_user`) connection — but migration `0066` (from `tushar`, issues #404-406) revoked
INSERT/UPDATE/DELETE on `modules` from `app_user` as a deliberate security hardening. Same root
cause as the `pnpm test` divergence above: CI's `platform_test` migration role never triggers the
default-privileges grant `0066` revokes, so this has presumably never surfaced there. Not
introduced by this merge — `0066` is `tushar`'s own commit — just newly surfaced by being the
first real boot against a `migration_user`-provisioned database. Logged, not fixed here (it's a
`module-service.ts` DB-access-path change, outside this pull's scope); server does not crash-loop
on it.

### Env vars

No new _required_ var — `tushar`'s new `JWT_MAX_TOKEN_AGE_SECONDS` ships with a safe default
(900s) in `packages/config/src/env.ts`. Existing `AUTHNEXUS_ISSUER`/`AUTHNEXUS_JWKS_URL`/
`AUTHNEXUS_AUDIENCE`/`AUTHNEXUS_PROJECT_ID` unchanged.

### Next

- Consider whether to align CI's `platform_test` migration role with `migration_user` (closing
  the divergence migration `0065` flagged) — separate decision, not done here.
- Full `pnpm test:isolation` run still outstanding against this fork's dev stack.
