# Implementation Plan: Platform Services — 2A

**Spec:** `docs/specs/platform-services-2a.md`
**Generated:** 2026-05-22
**Status:** not started
**GH issue:** #12
**Branch:** `feat/PLAT-12-platform-services-2a` (suggested)

---

## Phase 1 — Data Models + Core Package Logic

**Goal:** All three new tables exist in DB; `@platform/notifications`, `@platform/files`, and `@platform/audit` packages implement their core domain logic with unit tests; no API routes yet.
**Gate:** all unit tests pass, all three packages build clean → then Phase 2

| task | description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | requirement    | status |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ------ |
| T1   | `packages/db/migrations/0010_files.sql` — `files` table: id, tenant_id, module_slug, entity_id, original_name, storage_key, mime_type, size_bytes, scan_status CHECK, uploaded_by, created_at, updated_at. RLS policy. Indexes on `(tenant_id, scan_status)` + `(tenant_id, entity_id)`. Down migration. `-- analytics: excluded (files metadata may contain PII; managed via separate reporting view)`                                                                                                      | R4, R5, R7     | todo   |
| T2   | `packages/db/migrations/0011_admin_audit_log.sql` — `admin_audit_log`: id, tenant_id, actor_id, actor_type CHECK, resource_type, resource_id, action CHECK, before_snapshot JSONB, after_snapshot JSONB, metadata JSONB, created_at. RLS: USING only (no WITH CHECK = insert-only for app_user). Explicitly GRANT SELECT only to app_user and analytics_user — no UPDATE/DELETE. `-- analytics: included(id,tenant_id,actor_id,actor_type,resource_type,resource_id,action,created_at)` — snapshots excluded | R8, R9         | todo   |
| T3   | `packages/db/migrations/0012_view_configs.sql` — `view_configs`: id, tenant_id, entity_type_slug, list_columns JSONB, detail_layout JSONB, form_field_order JSONB, created_at, updated_at. UNIQUE (tenant_id, entity_type_slug). RLS. `-- analytics: included(id,tenant_id,entity_type_slug,created_at,updated_at)`                                                                                                                                                                                          | R11            | todo   |
| T4   | `packages/db/src/schema/platform.ts` — add Drizzle table definitions for `files`, `adminAuditLog`, `viewConfigs`                                                                                                                                                                                                                                                                                                                                                                                             | R4, R8, R11    | todo   |
| T5   | `packages/notifications/src/index.ts` — implement `sendNotification` (enqueues BullMQ job, validates templateId against Redis-cached set, throws `NotificationError('PROVIDER_UNAVAILABLE')` on Novu failure), `getUserPreferences`, `updateUserPreferences`. Add `NotificationError` typed error class. Add `notification_preferences` table entry to Drizzle schema (stored as JSONB in `tenants.config` — no new table needed, read/write via the tenants table config column)                            | R1, R2, R3     | todo   |
| T6   | `packages/notifications/src/index.test.ts` — unit tests: `sendNotification` enqueues job (mock BullMQ); unknown templateId throws on Redis miss; Novu outage throws `PROVIDER_UNAVAILABLE`; `getUserPreferences` returns defaults when key absent; `updateUserPreferences` merges correctly                                                                                                                                                                                                                  | R1, R2, R3     | todo   |
| T7   | `packages/files/src/index.ts` — implement `initiateUpload` (quota check via transaction, presigned POST with `content-length-range`, insert `files` row as `pending`), `confirmUpload` (enqueue AV scan job, idempotent), `getDownloadUrl` (blocks on non-clean status with typed errors), `deleteFile` (sets `scan_status='deleted'`, triggers async S3 delete + quota release)                                                                                                                             | R4, R5, R6, R7 | todo   |
| T8   | `packages/files/src/index.test.ts` — unit tests: quota exceeded → 422; file too large → 422; `getDownloadUrl` on pending/quarantined/failed → throws `FileError`; `confirmUpload` is idempotent; `deleteFile` releases quota                                                                                                                                                                                                                                                                                 | R4, R5, R6, R7 | todo   |
| T9   | `packages/audit/src/index.ts` — implement `writeAuditEntry(db, entry)`. Apply `redactMetadata` from `@platform/workflow-engine` to `before_snapshot` and `after_snapshot` using the entity field sensitivity map before insert. Attach as middleware to entity create/update/delete/transition in `@platform/entity-engine`                                                                                                                                                                                  | R8, R9, R14    | todo   |
| T10  | `packages/audit/src/index.test.ts` — unit tests: pii field in after_snapshot → `[REDACTED]`; public field verbatim; write is atomic with mutation (mock transaction); append-only (no update/delete exposed)                                                                                                                                                                                                                                                                                                 | R8, R9, R14    | todo   |

**Notes:**

- `notification_preferences` lives in `tenants.config` JSONB under the key `notification_prefs.{userId}` — no new table (avoids a migration just for preferences, and keeps it flexible per-user per-tenant)
- `@platform/audit` imports `redactMetadata` / `buildSensitivityMap` from `@platform/workflow-engine` — same logic as SSRF+PII T6; DRY
- BullMQ queue names: `notifications`, `av-scan`, `file-cleanup` — defined in `apps/worker/src/queues.ts`

---

## Phase 2 — API Routes + Workers + OpenAPI

**Goal:** All API routes live and tested; AV scan worker and file purge worker running; OpenAPI spec generated.
**Gate:** all route unit tests pass; worker tests pass; `GET /openapi.json` returns valid spec → then Phase 3

| task | description                                                                                                                                                                                                                                                                                                                                                                                                                                    | requirement    | status |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------ |
| T11  | File routes in `apps/api/src/routes/files/` — `POST /files` (T5 `initiateUpload` + quota check), `POST /files/:id/complete` (T5 `confirmUpload`), `GET /files/:id` (T5 `getDownloadUrl` — blocks pending/quarantined), `DELETE /files/:id` (admin only, soft-delete). Route-level unit tests.                                                                                                                                                  | R4, R5, R6, R7 | todo   |
| T12  | `apps/worker/src/av-scan.ts` — BullMQ job processor: call ClamAV TCP socket via `nvscan` or raw TCP, transition `scan_status` (`pending → clean \| quarantined \| scan_failed`). On quarantine: call `sendNotification` to alert tenant admin. On `scan_failed` after 5 retries: emit `system.error` event. Exponential backoff (1s, 2s, 4s, 8s, 16s). Idempotent — skip if already `clean/quarantined`. Unit tests with mocked ClamAV client. | R6, R13        | todo   |
| T13  | `apps/worker/src/file-cleanup.ts` — BullMQ recurring job (every 1h): find `files` rows with `scan_status='pending'` and `created_at < now() - 24h`; delete S3 object; release quota; delete row; log purge. Unit tests.                                                                                                                                                                                                                        | R13            | todo   |
| T14  | Audit log route in `apps/api/src/routes/admin/audit.ts` — `GET /admin/audit` with query params: `tenantId` (admin only), `actorId`, `resourceType`, `resourceId`, `from`, `to`, `limit` (max 100), cursor. Route unit tests.                                                                                                                                                                                                                   | R10            | todo   |
| T15  | View configs routes in `apps/api/src/routes/admin/view-configs.ts` — `GET /admin/view-configs/:entityType`, `PATCH /admin/view-configs/:entityType` (upsert, tenant-scoped). Route unit tests.                                                                                                                                                                                                                                                 | R11            | todo   |
| T16  | Notification preferences routes in `apps/api/src/routes/preferences/notifications.ts` — `GET /preferences/notifications`, `PATCH /preferences/notifications`. Route unit tests.                                                                                                                                                                                                                                                                | R2             | todo   |
| T17  | Wire `@hono/zod-openapi` — replace `@hono/zod-validator` on file + audit + view-config + preferences routes; `GET /openapi.json` handler in `apps/api/src/app.ts`. Add `NOVU_API_KEY`, `S3_*`, `CLAMAV_HOST`, `CLAMAV_PORT` validation to `@platform/config` if not already present.                                                                                                                                                           | R12            | todo   |
| T18  | PII-aware snapshots in `@platform/audit` — wire `buildSensitivityMap` + `redactMetadata` into `writeAuditEntry` for `before_snapshot` / `after_snapshot` fields using the entity field definitions from the engine. Integration test: audit row for an entity with a `pii` field has `[REDACTED]` in snapshot.                                                                                                                                 | R14            | todo   |

**Notes:**

- ClamAV client: use `clamscan` npm package or raw TCP (port 3310) to send file bytes for scanning
- `apps/worker/src/queues.ts` — centralise queue definitions; worker index mounts all processors
- `POST /files` must set `content-length-range` in the S3 presigned POST policy (min: 1, max: 100_000_000 bytes)
- Quota check in `initiateUpload` uses a `SELECT ... FOR UPDATE` on the tenant row to prevent concurrent upload races

---

## Phase 3 — Integration + Isolation Tests

**Goal:** Automated proof that all invariants hold end-to-end; tenant isolation confirmed for files, audit log, and view configs.
**Gate:** §R acceptance criteria fully met; all isolation tests pass (with live DB)

| task | description                                                                                                                                                                   | requirement | status |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ |
| T19  | `apps/api/tests/isolation/files.isolation.test.ts` — cross-tenant file access returns 404; tenant B cannot read tenant A's presigned URL; concurrent quota boundary test      | R5, R7      | todo   |
| T20  | `apps/api/tests/isolation/audit.isolation.test.ts` — tenant A cannot read tenant B's audit log; `UPDATE`/`DELETE` on `admin_audit_log` as `app_user` returns permission error | R9, R10     | todo   |
| T21  | `apps/api/tests/isolation/view-configs.isolation.test.ts` — tenant A override does not affect tenant B config; module seed re-run does not overwrite tenant override          | R11         | todo   |
| T22  | Integration test: full file upload flow — initiate → complete → AV scan (mock ClamAV) → `clean` status → download URL issued                                                  | R4, R6      | todo   |
| T23  | Integration test: quarantined file — AV scan returns infected → `quarantined` → download blocked + notification sent                                                          | R6          | todo   |

---

## Kick-Off Prompt

Copy this into your next Claude Code session to start Phase 1:

```
Read docs/specs/platform-services-2a.md and docs/specs/platform-services-2a-tasks.md.

Implement Phase 1 tasks only (T1–T10). Create branch feat/PLAT-12-platform-services-2a.

Key decisions from the spec:
- notification_preferences stored in tenants.config JSONB (no new table)
- @platform/audit reuses redactMetadata from @platform/workflow-engine — do not duplicate the logic
- BullMQ queue names: 'notifications', 'av-scan', 'file-cleanup' — defined in apps/worker/src/queues.ts
- Quota check in initiateUpload uses SELECT FOR UPDATE on tenant row (concurrent race prevention)
- Presigned POST policy MUST include content-length-range: [1, 100_000_000] — S3 enforces file size, not self-reported value
- admin_audit_log RLS: USING only policy (no WITH CHECK) means app_user can INSERT but never UPDATE/DELETE
- analytics annotation required on all new migrations (pnpm check-analytics-annotations)

Rules:
- Do not begin Phase 2 until all Phase 1 tests pass
- After each task run: pnpm --filter @platform/<package> test
- If you hit a decision not covered by the spec, stop and ask
```

---

_After each session: `/spec amend §B` for failures · `/spec amend §V` for recurring patterns_
