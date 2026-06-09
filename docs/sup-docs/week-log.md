# Week-over-Week Progress Log

**Format:** One entry per session or per milestone close. Newest at top.
**Purpose:** Running velocity record for an AI-first dev team. Update this at the start/end of each work session.

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
