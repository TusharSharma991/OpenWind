# Lens 1 — Incoming CTO: Architecture & Risk Review

**Document type:** External code-level review (independent)  
**Status:** Delivered 2026-06-23  
**Reviewer:** Arijeet Chakravarty  
**Lens:** Incoming CTO — could a new owner run and extend this _without_ the current team?  
**Method:** Source review of the monorepo — the three engines, `packages/db`/RLS, `apps/api`, `apps/worker`, migrations, infra.

> One of three independent lenses in this external review — CTO (architecture & risk), Product (capability & roadmap), and UX (adoption). Each document stands alone.

## Executive summary — _can I run this without the team?_

**Qualified yes — I can operate and extend it, but I would not let it carry real multi-tenant production traffic until four specific things are fixed.** The codebase is unusually clean for its age: disciplined transactional-outbox eventing, a real (not marketed) three-engine design, sandboxed expression evaluation, and broad structured logging (91 files import `@platform/logger`). It is _well-built_. But it is **not as safe as its own docs claim**, and the gap is concentrated in the one place that matters most for a multi-tenant SaaS: **tenant isolation is real in code but never actually verified, and its enforcement hinges on a config convention rather than a hard guarantee.** Combine that with an unbounded automation-recursion vector and dev-grade ops (secrets/storage backends commented out of `docker-compose`, no backups, shallow health check) and you have a platform that demos beautifully and will bite hard under load or under a misconfigured DB role.

The single hardest thing to operate without the original authors is the **automation/workflow eventing loop** (outbox → poller → BullMQ → recursive rule execution): it is clever, distributed across four files, and has a latent infinite-loop flaw that only reveals itself under specific rule configurations.

Blunt verdict: **I keep my job, but my first 30 days are a hardening sprint, not a feature sprint.**

## What it actually is (code-verified)

The README's thesis (`README.md:38-46`) — _"a support ticket, an expense claim, a sales deal… are all the same thing: a stateful object moving through a workflow"_ — is **genuinely implemented**, not aspirational marketing. The three-engine claim is real and the engines are distinct:

- **Entity engine** (`packages/entity-engine/src/engine.ts`) — CRUD over a JSONB-per-instance store with a real validation subsystem (schema-builder, ref-validator, sandboxed formula evaluator).
- **Workflow engine** (`packages/workflow-engine/src/engine.ts:24` `executeTransition`) — a real state machine with pessimistic locking (`FOR UPDATE NOWAIT`), condition/role/field guards, an append-only `workflow_events` log, and SLA scheduling.
- **Automation engine** (`packages/automation-engine/src/executor.ts:21` `executeAutomationRules`) — a rule matcher + 4 action types (notify/set-field/transition/webhook). It _imports_ the workflow engine's condition evaluator (`executor.ts:7`) rather than reimplementing it — a clean boundary.

**Verified end-to-end flow** (entity transition fires an automation): API handler `apps/api/src/routes/entities/execute-transition.ts:38` → `executeTransition` updates state + appends `workflow_events` + **always** writes a `workflow.transitioned` row to `outbox_events` in the same transaction (`workflow-engine/src/engine.ts:286`) → `apps/worker/src/outbox-poller.ts:23-48` polls `WHERE delivered_at IS NULL … FOR UPDATE SKIP LOCKED` every 2s and enqueues to BullMQ with `jobId = outbox row id` (dedup) → `apps/worker/src/automation-worker.ts:21-32` runs `executeAutomationRules` inside `withTenantContext` → `executor.ts:40-65` loads enabled rules matching the trigger, gates each via `evaluateConditionTree`, runs actions in a savepoint. **Automations are queued, not inline** — a genuinely good design.

Config interpretation is **safe**: condition trees are a closed switch over fixed operators (`packages/workflow-engine/src/condition-evaluator.ts:27-69`) — no `eval`, no `new Function`, no JSONLogic. The _one_ arbitrary-expression evaluator (formula fields) runs inside `isolated-vm` with an 8MB cap and 100ms timeout (`packages/entity-engine/src/validation/formula-evaluator.ts:27-65`).

Modules are **mostly** config-as-SQL: `modules/helpdesk/seed/` is a complete config-first module (entities, workflow, automation rules, view configs, all idempotent). The other six (`crm`, `invoicing`, etc.) are single non-idempotent stub seeds defining one entity each.

## Architecture overview

```
Browser ─► apps/admin-ui / apps/portal (React/Vite SPA)
              │ Bearer JWT (Zitadel)
              ▼
        apps/api (Hono)  ── per-route requireAuth → tenantId from JWT org claim
              │              writes to outbox_events (transactional)
              ▼
        Postgres (single postgres.js pool, max=10)  ◄── RLS policies + explicit WHERE tenant_id
              │  outbox_events
              ▼
        apps/worker  ── outbox-poller (2s) ─► BullMQ (Redis) ─► automation/sla/av-scan/export workers
```

- **Source of truth:** Postgres. `entity_instances` stores values in a single `fields jsonb` column (`packages/db/src/schema/entity-engine.ts:74`) — a JSONB hybrid, _not_ classic EAV, _not_ dynamic per-entity tables. Field _definitions_ live EAV-style in `entity_fields`.
- **Driver:** `postgres` (postgres.js) + Drizzle ORM (`packages/db/src/client.ts:6-11`), single shared pool, `DATABASE_POOL_MAX` default **10** (`packages/config/src/env.ts:31`). PgBouncer transaction-mode fronts it (correct for `SET LOCAL`-scoped RLS).
- **Multi-tenancy:** transaction-local `set_config('app.tenant_id', …, true)` via `withTenantContext` (`packages/db/src/middleware.ts:19-29`); real RLS policies exist for every tenant table (`packages/db/migrations/0001_rls_and_tenancy.sql:82-91`). **See the critical caveat below.**
- **Auth:** Zitadel JWT verified via cached JWKS (no per-request network hop); token introspection is opt-in on sensitive routes only, with a 60s in-process cache (`packages/auth/src/introspection.ts:5-35`).

## Top bottlenecks (ranked, with file refs)

1. **Per-request DB _write_ on every authenticated JWT request.** `packages/auth/src/middleware.ts:154-169` runs a `withTenantContext` transaction doing `.onConflictDoUpdate(...)` into `tenant_users` on **every** request. The comment directly above (`middleware.ts:143-145`) claims it's `onConflictDoNothing` ("one index scan per JWT call") — **the code is `onConflictDoUpdate`**, i.e. a HOT update + transaction round-trip per request. This is a write-amplification bomb at scale and a flat-out code-vs-comment lie.
2. **In-process-only caches in a horizontally-scaled service.** Tenant-status (`tenant-status-cache.ts:14`) and introspection (`introspection.ts:6`) are plain `Map`s. With N API instances: up to 30s for a tenant suspend/delete to propagate per instance, N× Zitadel introspection load, and **no cross-instance invalidation** — the code itself flags the missing Redis pub/sub channel (`tenant-status-cache.ts:6-9`) and ships without it.
3. **Rate limiter silently never keys by tenant.** It's a global `app.use` running _before_ any per-route `requireAuth` (`apps/api/src/app.ts:84`), so `c.get("auth")` is always undefined at `middleware/rate-limit.ts:57`. Every request falls through to XFF/`"unknown"` — the "key by tenant" intent is dead code; a missing/spoofed `x-forwarded-for` collapses many tenants into one bucket.
4. **Search-rank deep pagination is a scaling cliff.** `packages/entity-engine/src/search.ts:45-62` sorts by `ts_rank(...)` and uses it in the keyset cursor — `ts_rank` is recomputed per candidate row and is **not indexable**, so large-tenant search degrades to in-memory sort.
5. **`bulkUpdateEntities` is a genuine N+1** (`engine.ts:929-1110`): per-item `loadEntityType` + `loadEntityFields` + 2× validation-schema build, **with no per-type cache** — unlike `bulkCreateEntities` which memoizes (`engine.ts:809-821`). A 500-row single-type bulk update fires ~500× the metadata queries it needs.
6. **Low pool ceiling + Redis connection sprawl.** `DATABASE_POOL_MAX=10` is low for a service that opens a transaction per request; multiple independent ioredis connections per process rather than a shared one (`apps/api/src/lib/redis.ts:12`, `rate-limit.ts:7`, `apps/worker/src/automation-worker.ts:10`).

## Tech debt register (ranked, with file refs)

1. **🔴 Tenant-isolation RLS guarantee is never tested — the load-bearing assertion is `it.skip`.** The three tests that actually prove Postgres RLS blocks cross-tenant `SELECT` are skipped in all three engines: `apps/api/tests/isolation/{entity,workflow,automation}-engine.isolation.test.ts:324/310/159`. Honest in-code reason: CI runs as the `platform` _superuser_, which bypasses RLS, so the assertion can't pass. **Result: the platform's single most important guarantee is asserted to hold for `app_user` in prod but verified nowhere.** These are the only skipped tests in the repo.
2. **🔴 RLS enforcement hinges on a config convention, not code.** `withTenantContext` (the majority path) sets the tenant GUC but **never** `SET LOCAL ROLE app_user` — only `withTenantAndUserContext` does (`packages/db/src/middleware.ts:38`). Nothing uses `FORCE ROW LEVEL SECURITY`. So if `DATABASE_URL` ever points at the table owner/superuser, **RLS silently bypasses on nearly every route.** What actually protects most paths is the engine's pervasive explicit `eq(entityInstances.tenantId, tenantId)` filters (`engine.ts:213,253,370,477,…`) — which **directly contradict** `VISION.md:23` and `.claude/rules/db-conventions.md:17` ("Never add `WHERE tenant_id = ?` clauses"). The documented mental model is wrong, and the thing that really saves you is the thing the docs forbid.
3. **🔴 Unbounded automation recursion via the outbox.** `packages/automation-engine/src/actions/transition.ts` both (a) calls `executeTransition` — which **always** writes a new `workflow.transitioned` outbox row (`engine.ts:286`) — _and_ (b) calls `executeAutomationRules(..., depth + 1)` inline (`transition.ts:49`). So follow-up rules fire **twice**: once inline (depth-guarded by `MAX_DEPTH=10`) and again via the outbox poller, which calls at **depth 0** (`automation-worker.ts:29`). A rule cycle routed through the outbox **resets depth every hop → `MAX_DEPTH` can never fire**, and there's no `automation_executions` idempotency. Genuine duplicate-execution + infinite-loop vector, gated only by the 2s poll interval.
4. **🟠 Automation queue has no retries despite a comment claiming otherwise.** `apps/worker/src/queues.ts:13` creates the `automation` queue with **no `defaultJobOptions`** → BullMQ default `attempts=1`. The reassuring "attempts: 3 with exponential backoff… retried before… dead_letter_events" comment immediately below describes the `sla` queue, not this one. One transient DB blip dead-letters an automation on the first failure.
5. **🟠 Dead/silent functionality.** `notify` action is a no-op stub that only logs (`actions/notify.ts:10-25`, the repo's one real source TODO at `:8`). `entity.created`/`entity.assigned` triggers are first-class schemas (`event-schemas.ts:30-44`) but the entity engine **never emits them to the outbox** — any automation a user configures on them silently never runs. `setEntityState`/`bulkSetState` (`POST /:id/state`, `/bulk/state`) mutate `current_state` directly with no guards, no `workflow_events` row, and no outbox event — an unguarded state side-door where **automations never fire**.
6. **🟠 "Zero TypeScript in modules/" is literally false.** `VISION.md:21` says "if an engineer writes TypeScript inside modules/, something is wrong" — yet there are **7 `.ts` files + 7 tsconfigs + a `tsc` build pipeline** (`modules/*/src/index.ts`). They're one-line stubs, so the _spirit_ holds, but a doc that forbids what it ships is a credibility problem. Six of seven module seeds are also non-idempotent and define one entity each while their comments and `docs/sup-docs/roadmap-tracker.md:57` ("all 7 module seeds ✅ 100%") claim more.
7. **🟡 No down-migration story.** Drizzle Kit with no rollback runner; "down migrations" exist only as copy-paste SQL in header comments (`0001`, `0006`, `0009`). Duplicate on-disk numbering (two `0003_*`, two `0004_*`) — the `_journal.json` disambiguates but it's brittle for humans. Otherwise debt markers are genuinely low: 2 TODOs, 0 FIXME/HACK, `as any` and `console.log` are 100% confined to tests/scripts.
8. **🟡 Silent native-dep degradation.** `isolated-vm` is `require`'d in a try/catch (`formula-evaluator.ts:30-37`); if the native module fails to build, **every formula field silently evaluates to `null`** with only a `logger.warn` — data corruption presenting as a warning.

## Hidden / future risks & bus-factor

- **The eventing loop is the bus-factor epicenter.** outbox → poller → BullMQ → recursive rule execution spans `workflow-engine/engine.ts`, `automation-engine/executor.ts` + `actions/transition.ts`, and `worker/{outbox-poller,automation-worker,queues}.ts`. The double-trigger/depth-reset interaction (debt #3) is invisible unless you trace all four files together. **This is what bites the org in 6 months** — under a customer's clever rule chain, automations duplicate and potentially loop, and the depth guard everyone trusts does nothing.
- **The "RLS protects everything" belief is the dangerous institutional myth.** New engineers will read `VISION.md`/`db-conventions.md`, trust RLS, and stop writing the explicit tenant filters that are _actually_ doing the work — at which point a single misconfigured role or a path that forgets the filter leaks cross-tenant data. The docs actively train people toward the unsafe path.
- **Circuit breaker silently disabled in recursion** (`transition.ts:49` omits the `redis` arg → `executor.ts:175` skips the breaker). Protection exists only at depth 0.
- **No cross-instance cache invalidation** means a suspended/deleted tenant can keep serving for up to 30s per live API instance — a security/compliance gap, not just performance.

## Operational readiness

**Can I deploy/run/observe it? Partially — it's dev-grade.**

- **Secrets & storage backends are commented OUT of `docker-compose.yml`** (OpenBao ~L102-135, MinIO ~L162-195, labelled "NOT IN USE YET") — but `packages/secrets` and `packages/files` are implemented and `apps/api` depends on `@platform/secrets`. **The comment is stale; `docker compose up` does not start backends the code expects.** `.env.example` and `vitest.config.ts` both assume they're live.
- **No backups.** Zero hits for `pg_dump|pitr|wal-g|barman` across compose/scripts/docs. No restore runbook.
- **Health check is liveness-only.** `apps/api/src/app.ts:88` returns static `{status:"ok"}` — no DB/Redis/secrets readiness probe, no `/readyz`. **The worker has no HTTP server and no health endpoint at all** — an orchestrator cannot health-check it.
- **Loose image pinning** — `:latest` on Zitadel, pgbouncer, Novu, mailhog, bull-board. Non-reproducible, supply-chain risk.
- **CI is mostly honest but has holes.** `.github/workflows/ci.yml` runs format/lint/typecheck/build/test + isolation tests (with postgres/redis) + CodeQL + `pnpm audit`. But: **no e2e job** (`tests/e2e/` is empty `.gitkeep`; `test:e2e` is `--passWithNoTests` → vacuously green), **no coverage gate** (`fail_ci_if_error: false`), and the root `package.json` `ci` script diverges from `ci.yml` (omits `test:isolation`, adds `check-analytics-annotations` which CI doesn't run). The advertised `tests/{e2e,integration,isolation}/` top-level dirs are empty shells — real tests (~70 files) live under `apps/api/tests/` and `packages/*/src/*.test.ts`.
- **Positives:** sane Drizzle migration runner with a separate superuser `MIGRATION_DATABASE_URL` (`packages/db/src/run-migrations.ts`), `db:migrate` runs in CI, structured logging broadly adopted, graceful SIGTERM/SIGINT shutdown in both API and worker, transactional-outbox + DLQ discipline on the two most important queues, sandboxed expression eval, and `esbuild`/`hono` security forward-pins in `pnpm.overrides` (though undocumented — they belong in an ADR).

## Overall engineering-health rating: **6.5 / 10**

Genuinely well-architected and clean code (transactional outbox, real three-engine separation, sandboxed eval, low debt markers) dragged down by an untested-and-convention-dependent tenant-isolation guarantee, an unbounded automation-recursion flaw, and dev-grade ops — all of which are fixable in a focused 30-day hardening sprint, none of which are safe to ship to multi-tenant production as-is.

**My first four fixes, in order:** (1) run the isolation tests as `app_user` so RLS is actually proven, and either `FORCE RLS` or add `SET LOCAL ROLE app_user` to `withTenantContext`; (2) kill the automation double-trigger and carry `depth` through the outbox payload; (3) add `attempts`/backoff to the `automation` queue; (4) own OpenBao + MinIO in compose, add a readiness probe + backup runbook, and reconcile `VISION.md` with what the code actually does.
