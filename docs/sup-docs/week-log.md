# Week-over-Week Progress Log

**Format:** One entry per session or per milestone close. Newest at top.
**Purpose:** Running velocity record for an AI-first dev team. Update this at the start/end of each work session.

---

## 2026-06-16 — Track 2D Phase 1 — saved views API + entity export (issue #15)

**Session type:** Feature implementation
**Branch state:** `main`, 1 commit ahead of origin (6d804f0)

### Completed this session

**Track 2D Phase 1 backend (T1–T4, T6–T9 of 24)**

- **T1** — migration 0018: `saved_views` table with dual RLS policy (`tenant_id` + `user_id` GUCs), cascade FK to `entity_types`, analytics comment included
- **T2** — Drizzle schema (`packages/db/src/schema/saved-views.ts`); `withTenantAndUserContext` helper added to `packages/db/src/middleware.ts` — sets both `app.tenant_id` and `app.user_id` in one call
- **T3** — saved-views CRUD: `GET /saved-views?entityTypeId=`, `POST /saved-views` (max-20 limit, userId always from auth), `PATCH /saved-views/:id`, `DELETE /saved-views/:id`; wired into `app.ts`
- **T4** — 11-test unit suite: list, create 201, max-20 → 409, userId injection prevention, isDefault clears prior, update 200/404, delete 204/404 — all passing
- **T6–T8** — `GET /entity-types/:id/export?format=csv|xlsx`; PII/financial field exclusion by role; EXPORT_TOO_LARGE guard at 10k; system cols first; exceljs bold header + auto-width; routed before `/:id` to avoid conflict
- **T9** — 14-test export suite: CSV/xlsx content-types, PII exclusion by role (agent vs pii_export/admin), EXPORT_TOO_LARGE, empty → headers-only, 404 on missing entity type — all passing

**Key implementation notes:**

- `getEntityType` throws `EntityError("ENTITY_TYPE_NOT_FOUND")` rather than returning null — caught and mapped to 404
- xlsx uses `c.newResponse()` not `new Response()` to avoid undici-types portability error
- `requireAuth()` mock in export tests is a pass-through so `makeApp(roles)` controls per-test role

### Still pending (Phase 1 gate not fully met)

- **T5** — saved-views RLS isolation test (`tests/isolation/saved-views.test.ts`) — needs Docker stack running; skipping until integration environment is available

### Phase snapshot

| Track                          | Status                             |
| ------------------------------ | ---------------------------------- |
| Track 2D — no-code + reporting | 🔄 Phase 1 backend: 8/9 tasks done |

---

## 2026-06-16 — Pre-pilot engine fixes (#76–#84); PR #89 merged

**Session type:** Bug fix / pre-pilot hardening
**Branch state:** `main`, clean (PR #89 merged — f51ac01)

### Completed this session

**9 issues closed (#74–#84 scope — #74/#75 were prior, #76–#84 this session)**

- **#76 — ioredis migration**: created `@platform/redis` singleton package (`getRedis`, `closeRedis`); removed `node-redis` from `entity-engine`; schema-cache SCAN cursor fixed to string `"0"`, SET EX uses ioredis positional args, DEL spreads keys
- **#77 — idempotency pre-lock**: moved idempotency read-only SELECT before `FOR UPDATE NOWAIT` in `executeTransition` to short-circuit without acquiring the write lock
- **#78 — bulkCreateEntities O(N) DB calls**: request-scoped `Map` caches `entityType` + `allFields` per `typeId`; schema stays per-item (uses its own Redis cache)
- **#79 — deleteEntity single round-trip**: collapsed SELECT + UPDATE into `UPDATE...RETURNING` with `isNull(deletedAt)` in WHERE
- **#80 — error handler messages**: workflow and entity engine errors return human-readable `message` fields instead of raw codes
- **#81 — ActionConfig discriminated union**: replaced `Record<string,unknown>` config + unsafe casts in executor with a typed discriminated union; all switch arms narrow cleanly
- **#82 — duplicate migration prefixes**: renumbered `0001`/`0002` collisions to sequential `0002`/`0003`/`0004`; Drizzle journal updated
- **#83 — automation-engine notify async**: removed spurious `async` from `executeNotifyAction` (no await); added TODO for re-wire
- **#84 — /health NODE_ENV leak**: removed `env: env.NODE_ENV` from health response body

**PR #89 review fixes (two rounds):**

- Added `server.deps.inline` for `@platform/redis` + `@platform/db` to all three engine vitest configs
- Wired `closeRedis()` into graceful shutdown for `apps/api` (new SIGTERM/SIGINT handler) and `apps/worker`
- Fixed residual `isRedisReady()` call in `invalidateSchemaCache`
- Added 6-test suite for `@platform/redis` (singleton, constructor args, error handler, quit, reset, no-op)
- Fixed `tsconfig.json` to exclude test files from tsc build
- `server.close()` wrapped in `Promise` so in-flight requests drain before `closeRedis()` on SIGTERM

### Phase snapshot

| Track                                | Status                        |
| ------------------------------------ | ----------------------------- |
| Issues #76–#84 (pre-pilot hardening) | ✅ All closed — PR #89 merged |
| 2D (no-code builders + reporting)    | 🔴 Not started — next track   |

---

## 2026-06-10 — Tenant lifecycle (issue #5 items 1+2); PR #86 open

**Session type:** Implementation
**Branch state:** `feat/PLAT-5-tenant-lifecycle`, PR #86 open

### Completed this session

**Issue #5 — Tenant lifecycle, items 1+2 (item 3 outbox retention deferred)**

- **Migration 0013**: `suspended_at` and `deletion_scheduled_at` columns on `tenants`; partial index `tenants_deletion_due_idx` for purge worker
- **`packages/auth` — tenant status cache**: 30 s TTL Map-based cache (`tenant-status-cache.ts`); `invalidateTenantStatusCache` exported; auth middleware enforces 403 (suspended) / 404 (deleted / purged) on every authenticated request
- **`apps/api` — tenant-lifecycle service**: `provisionTenant`, `suspendTenant`, `reactivateTenant`, `scheduleTenantDeletion`; typed `TenantLifecycleError`; cache invalidated on every transition; 30-day BullMQ purge job enqueued by `scheduleTenantDeletion`
- **Admin routes** `/admin/tenants` (POST / GET / PATCH suspend+reactivate / DELETE): all gated by `requireRole("superadmin") + requireIntrospection()`
- **`apps/worker` — tenant-purge BullMQ worker**: concurrency=1; FK-safe deletion order; audit log retained; marks tenant `purged` on completion; idempotent
- **Tests**: 9 unit tests (lifecycle service); auth middleware mock updated for `db`/`tenants` imports; 38/38 typecheck clean; 21/21 auth tests pass

### Phase snapshot

| Track                                 | Status                                |
| ------------------------------------- | ------------------------------------- |
| Issue #2 (SSRF + PII)                 | ✅ Done — PR #85 merged               |
| Issue #5 (tenant lifecycle items 1+2) | 🟡 PR #86 open — awaiting CI + review |

---

## 2026-06-09 — 2A Phase 3 complete (T18–T23); PR #85 updated

**Session type:** Implementation
**Branch state:** `feat/PLAT-12-platform-services-2a`, ahead of `main`, PR #85 open

### Completed this session

**2A Phase 3 — PII-aware audit snapshots + integration / isolation tests**

- **T18 — audit hook in entity engine**: added `audit-hook.ts` with `registerEntityAuditHook` / `fireEntityAuditHook` / `isEntityAuditHookRegistered`. Preserves `packages/entity-engine → packages/db only` dependency rule — hook is a callback registered by `apps/api` at startup, not a direct import.
- Entity engine `createEntity`, `updateEntity`, `deleteEntity` now fire the hook with before/after snapshots and the field sensitivity map.
- `apps/api/src/app.ts` registers `writeAuditEntry` as the hook at module load, inside the same DB transaction.
- **T19 — files RLS isolation test**: 5 assertions — cross-tenant read blocked, own-tenant read allowed, cross-tenant delete returns FILE_NOT_FOUND, cross-tenant `confirmUpload` throws FileError.
- **T20 — audit_log RLS isolation test**: 4 assertions — cross-tenant raw SELECT blocked, `queryAuditLog` API scoped to correct tenant.
- **T21 — view_configs RLS isolation test**: 5 assertions — cross-tenant read + write (INSERT WITH CHECK) blocked.
- **T22 — upload flow integration**: 6 tests — `initiateUpload` → `confirmUpload` → `getDownloadUrl` → quarantine guard → `deleteFile` → size limit guard.
- **T23 — quarantine lifecycle integration**: 6 tests — `pending` download blocked, quarantined blocked, `scan_failed` blocked, clean succeeds, idempotent re-download.
- Fixed wrong function names (`completeUpload` → `confirmUpload(db, redis, tenantId, fileId)`, `downloadFile` → `getDownloadUrl`) in all three test files.
- Fixed `FieldSensitivity` re-export: `workflow-engine/index.ts` now re-exports it from `@platform/entity-engine` so `@platform/audit` can import transitively.
- All 141 unit tests pass. Integration/isolation tests require `docker compose up -d` (expected).

### Phase snapshot

- Phase 1: **100% complete**
- Phase 2 — 2A: **~95%** (pending: CI green on Docker test suite before merge)
- Phase 2 — 2B/2C/2D: 0% (next)

### Next actions

- [ ] CI must pass on full Docker stack before merging PR #85
- [ ] Start 2B: module system + seed SQL for helpdesk, CRM, reimbursements
- [ ] Phase exit decision (2A → 2B) requires human sign-off

---

## 2026-06-09 — 2A Phase 1 + 2 complete; SSRF/PII PR merged

**Session type:** Implementation
**Branch state:** `feat/PLAT-12-platform-services-2a`, ahead of `main`, PR open

### Completed this session

**SSRF + PII hardening (PR #73 — merged)**

- Fixed `opts.all = true` crash in `webhook.ts` `lookupFn` (`ERR_INVALID_IP_ADDRESS` on Docker happy-eyeballs path)
- PR reviewed by abmish, all 6 blockers resolved, CI green, merged to main

**2A Phase 1 — packages**

- `@platform/notifications`: Novu wrapper, user preference CRUD, `sendNotification`, `getUserPreferences`, `updateUserPreferences`
- `@platform/files`: `initiateUpload` (S3 presigned PUT, quota guard, AV scan queue enqueue), `completeUpload`, `downloadFile`, `deleteFile`, `FileError`
- `@platform/audit`: `writeAuditEntry`, `queryAuditLog`, PII redaction via `redactMetadata` + `buildSensitivityMap`
- DB migrations 0007–0009: `files`, `view_configs`, `audit_log` tables (all with RLS, tenant indexes)

**2A Phase 2 — API routes + workers**

- `apps/api`: file initiate/complete/download/delete routes, admin audit log + view-config routes, notification preferences get/patch routes, `/openapi.json` endpoint, shared Redis client
- `apps/worker`: av-scan BullMQ worker (ClamAV INSTREAM TCP, lazy S3, quarantine notification), file-cleanup hourly recurring worker (purges stale pending files, implicit quota via row deletion)
- 34 tests: 12 file API route tests, 3 av-scan tests, 4 file-cleanup tests (all green)

**Test infra fixes**

- vitest 4.x: `S3Client` and `net.Socket` constructor mocks must use `function` keyword (not arrow function)
- BullMQ Worker processor captured at import time; `beforeEach` must NOT clear the reference

### Phase snapshot

- Phase 1: **100% complete**
- Phase 2 — 2A: **~65%** (Phase 3 integration tests T19–T23 remain)
- Phase 2 — 2B/2C/2D: 0% (next)

### Next actions

- [ ] 2A Phase 3 (T19–T23): isolation + integration tests for files, audit, view-configs; full upload flow; quarantine flow
- [ ] Start 2B: module system + seed SQL for helpdesk, CRM, reimbursements
- [ ] T18 (PII-aware snapshots): wire `buildSensitivityMap` + `redactMetadata` into entity engine hooks

---

## 2026-05-22 — Phase 1 complete, Phase 2 triage

**Session type:** Analysis + cleanup
**Branch state:** `main`, clean

### Completed this session

- Deleted stale local branch `feat/PLAT-007-infrastructure-tenancy-secrets`
- Removed `contributor` remote tracking ref
- Created `docs/sup-docs/` tracking suite

### Phase snapshot

- Phase 1: **100% complete** (all 5 tracks + security hardening closed)
- Phase 2: **0% started** — 4 tracks open, 7 carry-over issues to triage
- Phase 3: **0% started**

### Open Phase 2 blockers to triage

- #3 Workflow reliability gaps (PrabhuVijit — assigned, no PR yet)
- #5 Tenant lifecycle / audit log / outbox retention (abmish — architecture decision pending)
- #2 Data isolation & PII leakage (unassigned)
- #4 Schema cache & Redis efficiency (unassigned)
- #62 Workflow version GC + stuck instances (unassigned)
- #64 Transition rollback / undo policy (unassigned)
- #65 Parallel approval edge cases (unassigned)

### Carry-over triage completed (same session)

- ✅ Closed #3 (tracker — all sub-items resolved)
- ✅ Closed #64 (transition rollback → irreversible by design, ADR-002 WE-02 resolved)
- 🔴 #2 flagged PILOT BLOCKER — SSRF + PII, must land before any customer data
- 🟡 #5 folded into 2A — items 1+2 are 2A work; item 3 deferred to load testing
- 🟡 #4 deferred to pre-GA / load testing
- 🟡 #62 deferred to before 2D (workflow editor)
- 🟡 #65 re-labelled phase:3 — parallel approval off-limits for pilot

### Next actions

- [ ] Start 2A — platform services (Novu, files, audit log, view_configs)
- [ ] #2 (SSRF + PII) must be assigned and worked in parallel with 2A
- [ ] #5 items 1+2 land as part of 2A

---

## 2026-05-20 to 2026-05-21 — Security hardening sprint

**Tracks:** 1-SEC
**PRs merged:** #66 (api keys, ReDoS, cross-tenant user_ref, OpenBao), hotfixes #67, #68, #69
**Issues closed:** #1, #8, #22, #67, #68, #69 → Phase 1 security complete

---

## 2026-05-19 to 2026-05-20 — Automation engine + reliability fixes

**Tracks:** 1E complete, reliability issues 3.1–3.5
**PRs merged:** #49 (automation engine), #58 (SLA timer + TRANSITION_LOCKED)
**Issues closed:** #11 (1E), #59, #60, #61, #63

---

## 2026-05-18 to 2026-05-19 — Workflow engine + entity engine

**Tracks:** 1C complete, 1D complete
**PRs merged:** #33 (entity engine), #40, #41 (workflow engine)
**Issues closed:** #9 (1C), #10 (1D), #24–#39

---

## 2026-05-14 to 2026-05-18 — Infrastructure + auth

**Tracks:** 1A complete, 1B complete
**PRs merged:** #20, #21 (infra/tenancy), #23 (auth)
**Issues closed:** #7 (1A)

---

## 2026-05-13 to 2026-05-14 — Project kickoff

**Scope:** Repo scaffold, architecture docs, ADRs, issue backlog created (issues #1–#19)
**Deliverables:** CLAUDE.md, architecture-brief.md, ADR-001 through ADR-004, roadmap.md, all GH milestones
