# Platform Services — 2A

> Cross-cutting services every module depends on: notifications, file storage, audit log, view configs, OpenAPI spec.

status: draft
created: 2026-05-22
updated: 2026-05-23 (rev2)
reviewed: 2026-05-22
gh: #12

---

## §G Goal

- Modules can send notifications via Novu without any TypeScript per-module code
- Files upload/download through tenant-scoped presigned URLs with quota + virus scan
- Every entity mutation is captured in an immutable, queryable audit log
- UI layer has a `view_configs` table to drive generic list/detail/form rendering
- OpenAPI spec auto-generated from existing Zod validators

---

## §C Constraints

| constraint             | value                                                                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| stack                  | Novu (notifications), S3/MinIO (files), ClamAV daemon via TCP socket / REST API (scanning), Drizzle, Hono, `@hono/zod-openapi`                                                               |
| auth                   | All endpoints require JWT; file access validates tenant ownership before signing                                                                                                             |
| notification templates | Defined in Novu, never in TypeScript — config-first invariant                                                                                                                                |
| audit log              | Append-only at DB level: no UPDATE/DELETE RLS policy on `admin_audit_log`                                                                                                                    |
| out of scope           | Email template builder UI (Phase 3); per-field audit diff (Phase 3); Metabase integration (2D); in-app Novu inbox UI component (2C); audit log retention policy (Phase 3 / compliance track) |
| depends on             | #7 (1A infra), #8 (1B auth) complete                                                                                                                                                         |
| upload URL expiry      | Presigned upload URL expires in 15 min; presigned download URL expires in 1h                                                                                                                 |
| per-file size limit    | Max 100MB per individual file; enforced at `POST /files` before presigned URL is issued                                                                                                      |
| pending file TTL       | `files` rows with `scan_status='pending'` older than 24h are treated as abandoned and purged; `failed` scans are NOT purged (alert developer)                                                |
| notification delivery  | `sendNotification` enqueues a BullMQ job — never called synchronously inside a DB transaction; Novu outages do not block mutations or exhaust connection pool                                |
| env requirements       | `CLAMAV_HOST` (TCP address of scan daemon), `CLAMAV_PORT` (TCP port of daemon), `SSRF_BLOCK_CIDRS` (SSRF CIDR list), `REDIS_URL` (cache for template/schema metadata)                        |
| storage quota config   | Stored in `tenants.config` under `config: { storage_quota_mb: number }` (JSONB path: `$.storage_quota_mb`, defaults to `5120` [5GB] if unspecified)                                          |

---

## §I Interfaces

### `@platform/notifications`

```typescript
sendNotification(tenantId: string, userId: string, templateId: string, payload: Record<string, unknown>, options?: { digestKey?: string }): Promise<void>
getUserPreferences(tenantId: string, userId: string): Promise<NotificationPreferences>
updateUserPreferences(tenantId: string, userId: string, prefs: Partial<NotificationPreferences>): Promise<void>

type NotificationPreferences = {
  channels: { email: boolean; inApp: boolean; sms: boolean }
  templateOverrides: Record<string, { email?: boolean; inApp?: boolean; sms?: boolean }>
}

// Notification Integration Mapping:
// modular event notifications are wired directly in the Automation Engine's rule configurations.
// The Automation Engine's "notify" action JSON contains the exact Novu `templateId` parameter,
// and resolves custom trigger variables from the event payload context.
// Valid template IDs are preloaded in Redis to support fast, non-blocking synchronous check of `templateId` in `sendNotification`.
```

### `@platform/files`

```typescript
initiateUpload(tenantId: string, moduleSlug: string, entityId: string, filename: string, mimeType: string, sizeBytes: number): Promise<{ uploadUrl: string; uploadUrlExpiresAt: Date; fileId: string }>
confirmUpload(tenantId: string, fileId: string): Promise<void>
getDownloadUrl(tenantId: string, fileId: string): Promise<{ downloadUrl: string; downloadUrlExpiresAt: Date }>
deleteFile(tenantId: string, fileId: string): Promise<void>

export class FileError extends Error {
  constructor(
    public readonly code: FileErrorCode,
    public readonly meta?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "FileError";
  }
}

export type FileErrorCode =
  | "QUOTA_EXCEEDED"
  | "FILE_TOO_LARGE"
  | "FILE_PENDING_SCAN"
  | "FILE_QUARANTINED"
  | "FILE_NOT_FOUND"
  | "SCAN_FAILED"
  | "PROVIDER_ERROR";
```

### File storage path pattern

```
{tenantId}/{moduleSlug}/{entityId}/{uuid}-{filename}
```

### `files` table (new)

```sql
files (
  id UUID PK,
  tenant_id UUID NOT NULL,  -- RLS
  module_slug TEXT NOT NULL,
  entity_id UUID,
  original_name TEXT NOT NULL,
  storage_key TEXT NOT NULL,  -- S3 path
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  scan_status TEXT NOT NULL DEFAULT 'pending',  -- pending | clean | quarantined | deleted | failed
  uploaded_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()  -- updated on every scan_status transition
)
```

### `admin_audit_log` table (new)

```sql
admin_audit_log (
  id UUID PK,
  tenant_id UUID NOT NULL,
  actor_id UUID NOT NULL,
  actor_type TEXT NOT NULL,  -- user | api_key | system
  resource_type TEXT NOT NULL,  -- entity_type slug
  resource_id UUID NOT NULL,
  action TEXT NOT NULL,  -- created | updated | deleted | transitioned
  before_snapshot JSONB,  -- null for create
  after_snapshot JSONB,   -- null for delete
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
-- no UPDATE/DELETE policy — append-only enforced at DB level
```

### `view_configs` table (new)

```sql
view_configs (
  id UUID PK,
  tenant_id UUID NOT NULL,
  entity_type_slug TEXT NOT NULL,
  list_columns JSONB NOT NULL,   -- [{ field, label, width?, sortable? }]
  detail_layout JSONB NOT NULL,  -- [{ group, fields[] }]
  form_field_order JSONB NOT NULL,  -- [field_slug]
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entity_type_slug)
)
```

### API routes

```
POST   /files                          → initiate upload, return presigned URL + fileId
POST   /files/:id/complete             → signal upload finished; enqueue AV scan job
GET    /files/:id                      → validate ownership, return presigned download URL
DELETE /files/:id                      → soft-delete (sets scan_status='deleted'), admin only

GET    /admin/audit                    → filterable log (tenantId, actorId, resourceType, resourceId, from, to, limit, cursor)

GET    /admin/view-configs/:entityType → get view config for entity type
PATCH  /admin/view-configs/:entityType → override view config (tenant-scoped)

GET    /preferences/notifications      → get current user's notification preferences
PATCH  /preferences/notifications      → update current user's notification preferences

GET    /openapi.json                   → auto-generated OpenAPI 3.1 spec
```

---

## §R Requirements

**Notifications**

R1: Automation engine `notify` action sends notifications via Novu using a template ID and payload. No platform TypeScript defines template content.
✓ Calling `sendNotification(tenantId, userId, 'ticket.assigned', { ticketId })` delivers via Novu without any hardcoded template in platform code
✓ Unknown `templateId` does not silently drop — the BullMQ worker validates against a Redis-cached set of known Novu template IDs (TTL: 5 min); an unknown ID transitions the job to `failed`, emits a `system.error` event, and triggers an oncall alert
✓ When Novu is unavailable, `sendNotification` throws a typed `NotificationError('PROVIDER_UNAVAILABLE')` — caller decides retry; notification is never silently dropped

R2: Users can read and update their notification channel preferences (email, in-app, SMS) via the preferences API.
✓ `GET /preferences/notifications` returns current preferences
✓ `PATCH /preferences/notifications` persists changes; subsequent GET reflects update

R3: Novu digest batching is supported — the `notify` call passes enough metadata for Novu digest workflows to group notifications.
✓ `sendNotification` accepts an optional `digestKey` field; passed to Novu as digest group key when present

**Files**

R4: Upload flow is three-step: platform issues presigned URL, client uploads directly to S3, client calls complete endpoint to trigger scan.
✓ `POST /files` returns `{ uploadUrl, fileId }` without touching file bytes
✓ File metadata row exists in `files` table immediately after `POST /files` with `scan_status = 'pending'`
✓ `POST /files/:id/complete` enqueues the AV scan BullMQ job; is idempotent — duplicate calls do not enqueue additional jobs
✓ Presigned POST policy includes `content-length-range` (1 byte min, 100MB max) — S3 rejects uploads that violate the signed size bounds server-side

R5: All file access is tenant-scoped. A tenant cannot access files belonging to another tenant.
✓ `GET /files/:id` returns 404 for a valid file ID that belongs to a different tenant
✓ S3 paths include `tenantId` prefix — direct bucket access without a signed URL is blocked at bucket policy level

R6: File uploads are checked for malware asynchronously. Infected files are quarantined; pending files are not served.
✓ After `POST /files/:id/complete`, a background job runs AV scan; `scan_status` transitions `pending → clean | quarantined`
✓ If the AV scanner fails or times out, the BullMQ job retries up to 5 times with exponential backoff; if all retries fail, status transitions `pending → failed` (developer alerted; file not purged automatically)
✓ `GET /files/:id` on a `pending` or `failed` file returns 422 — download URL not issued
✓ `GET /files/:id` on a `quarantined` file returns 422 with reason; never issues a download URL
✓ Tenant admin receives a notification when a file is quarantined

R7: Storage quota is enforced per tenant at upload time; size limits are enforced at S3 level, not on self-reported values.
✓ `POST /files` reserves quota by adding file `sizeBytes` to the tenant's current usage, returning 422 if it would exceed `config.storage_quota_mb`
✓ If a reserved upload is never completed, its quota reservation is cleared when it is purged after 24 hours
✓ `POST /files` returns 422 if `sizeBytes` exceeds 100MB regardless of remaining quota
✓ Presigned POST policy `content-length-range` prevents a client from claiming a small size and uploading a large file — S3 enforces the limit before the object is written
✓ Two concurrent uploads at the quota boundary result in at most one succeeding — the second receives 422 (enforced by concurrent transaction check)
✓ Soft-deleted files (`scan_status='deleted'`) immediately trigger an asynchronous physical deletion of their S3 object, and their storage quota is immediately reclaimed and deducted from tenant usage

**Audit log**

R8: Every entity create, update, delete, and workflow transition is captured in `admin_audit_log`.
✓ After `POST /entities/:typeId`, a row exists in `admin_audit_log` with action=created, correct actor, before=null, after=entity snapshot
✓ After `POST /entities/:id/transitions`, a row exists with action=transitioned, before/after state captured
✓ Bulk operations (bulk create, bulk update) produce one audit row per affected entity — not one batch row
✓ Audit writes are in the same transaction as the entity mutation — no orphaned mutations without audit entries

R9: `admin_audit_log` is append-only for all application-level database roles.
✓ Executing `UPDATE admin_audit_log SET ...` as `app_user` or `analytics_user` returns a permission error — no rows are modified
✓ Executing `DELETE FROM admin_audit_log` as `app_user` or `analytics_user` returns a permission error — no rows are deleted
✓ The migration for `admin_audit_log` contains no GRANT of UPDATE or DELETE to any application role

R14: `before_snapshot` and `after_snapshot` in `admin_audit_log` must not contain raw PII or financial field values.
✓ After an entity update where one field has `sensitivity='pii'`, the audit row's `after_snapshot` contains `"[REDACTED]"` for that field value, not the raw value
✓ Field names are retained; only values are redacted — audit entry remains queryable by resource type and actor
✓ Redaction is applied in the `@platform/audit` middleware before the DB write, using the same redaction logic as `ssrf-pii-hardening` T6
✓ Fields with `sensitivity='public'` or `sensitivity='internal'` are written verbatim

R10: Audit log is queryable by tenantId, actorId, resourceType, resourceId, and date range with cursor pagination.
✓ `GET /admin/audit?resourceType=ticket&from=2026-01-01` returns matching rows
✓ Response includes a cursor for the next page; page size max 100

**View configs**

R11: Module seed SQL sets default `view_configs` rows for each entity type. Tenants can override per entity type.
✓ After installing helpdesk module, `view_configs` has a row for `ticket` with sensible list/detail/form defaults
✓ `PATCH /admin/view-configs/ticket` persists tenant override; subsequent GET returns overridden config
✓ Override does not affect other tenants' view configs for the same entity type
✓ Re-running module seed SQL (reinstall) does not overwrite an existing tenant override — seed uses INSERT ... ON CONFLICT DO NOTHING

R13: Abandoned pending file rows are purged automatically.
✓ A background job runs at least once per hour; any `files` row with `scan_status='pending'` and `created_at < now() - 24h` is deleted along with its S3 object
✓ `scan_failed` files are never targeted by this job — only `pending` rows are eligible for abandonment purge
✓ Purge is logged with tenant ID, file ID, and reason='abandoned'
✓ Purged file IDs do not count against tenant quota; the purge job releases any reserved quota when deleting a `pending` row

**OpenAPI**

R12: `GET /openapi.json` returns a valid OpenAPI 3.1 spec derived from Zod validators, with no manual maintenance.
✓ Adding a new route with a Zod validator causes it to appear in the spec without manual edits
✓ Spec includes auth requirements (JWT bearer) on all protected routes

---

## §V Invariants

- Files are never served via direct S3 URLs — always presigned, always tenant-validated
- Presigned upload URLs expire in 15 min; download URLs expire in 1h — never long-lived
- `pending`, `failed`, and `quarantined` files never yield a download URL — only `clean` files are served
- S3 presigned POST policy enforces `content-length-range` — self-reported `sizeBytes` alone is not the enforcement mechanism
- `sendNotification` enqueues a BullMQ job; it is never called synchronously inside a DB transaction
- Pending file rows older than 24h are abandoned; purge job removes both row and S3 object (failed files are retained for investigation)
- Soft-deleted files immediately purge their physical S3 object and release tenant quota bounds
- Audit log rows are written in the same transaction as the mutation they describe
- `admin_audit_log` grants no UPDATE or DELETE to any application role — enforced in migration, not only in application code
- Notification templates live in Novu, never in platform TypeScript; event mappings are defined inside Automation Engine rule configurations
- `sendNotification` never silently drops a notification — it throws on any failure; templates are validated synchronously against a local Redis cache of valid IDs
- `view_configs` seed uses INSERT ... ON CONFLICT DO NOTHING — reinstall never overwrites tenant overrides
- `view_configs` has one row per (tenant, entity_type) — UNIQUE constraint enforced
- PII/financial field values in `before_snapshot`/`after_snapshot` are redacted to `"[REDACTED]"` before insert; field names are retained (R14, T16)
- Sensitivity lookup is retrieved via the Entity Engine's high-speed memory-cached schema representation to avoid database query overhead (N+1 prevention)

---

## §T Tasks

| id  | task                                                                                                                                                                            | phase       | status                                                                                                               | depends         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------- | --------------- | ---- | ----- |
| T1  | Migration: `files` table + RLS + indexes                                                                                                                                        | 1           | todo                                                                                                                 | —               |
| T2  | Migration: `admin_audit_log` table + append-only RLS + indexes                                                                                                                  | 1           | todo                                                                                                                 | —               |
| T3  | Migration: `view_configs` table + RLS + unique constraint                                                                                                                       | 1           | todo                                                                                                                 | —               |
| T4  | `@platform/notifications` package: `sendNotification`, `getUserPreferences`, `updateUserPreferences` wrapping Novu SDK                                                          | 1           | todo                                                                                                                 | —               |
| T5  | `@platform/files` package: `initiateUpload` (with `content-length-range` in POST policy), `confirmUpload`, `getDownloadUrl`, `deleteFile`; S3 path convention; quota check      | 1           | todo                                                                                                                 | T1              |
| T6  | `@platform/audit` package: `writeAuditEntry`; middleware that hooks entity create/update/delete/transition                                                                      | 1           | todo                                                                                                                 | T2              |
| T7  | File routes: `POST /files`, `POST /files/:id/complete`, `GET /files/:id` (block on pending/quarantined/scan_failed), `DELETE /files/:id` (removes S3 object immediately)        | 2           | todo                                                                                                                 | T5              |
| T8  | AV scan BullMQ job (triggered by `confirmUpload`): retry policy (5×, exponential backoff); `pending → clean                                                                     | quarantined | scan_failed`transitions; quarantine notifies tenant;`scan_failed` triggers developer alert; idempotent enqueue guard | 2               | todo | T5,T4 |
| T9  | Audit log routes: `GET /admin/audit` with filtering + cursor pagination                                                                                                         | 2           | todo                                                                                                                 | T6              |
| T10 | Notification preferences routes: `GET /preferences/notifications`, `PATCH /preferences/notifications`                                                                           | 2           | todo                                                                                                                 | T4              |
| T11 | View configs routes: `GET /admin/view-configs/:entityType`, `PATCH /admin/view-configs/:entityType`                                                                             | 2           | todo                                                                                                                 | T3              |
| T12 | Wire `@hono/zod-openapi`; `GET /openapi.json` route                                                                                                                             | 2           | todo                                                                                                                 | T7,T9,T10,T11   |
| T13 | Integration tests: quota boundary (concurrent uploads), scan flow state transitions, audit write atomicity, view config isolation, Novu outage throws                           | 3           | todo                                                                                                                 | T5,T6,T7,T8,T11 |
| T14 | Isolation tests: cross-tenant file access (expect 404), cross-tenant audit log, cross-tenant view config                                                                        | 3           | todo                                                                                                                 | T7,T9,T11       |
| T15 | Abandoned file purge job (BullMQ recurring): delete `pending` rows + S3 objects older than 24h; release reserved quota; log purge; `scan_failed` rows excluded                  | 2           | todo                                                                                                                 | T5              |
| T16 | PII-aware snapshot capture in `@platform/audit` middleware: call ssrf-pii-hardening redaction logic on entity field values before persisting `before_snapshot`/`after_snapshot` | 2           | todo                                                                                                                 | T6, ssrf T6     |

phase gate: all unit + integration tests pass before advancing to next phase

## §B Bugs / Backprop Log

| id  | what failed | root cause | promoted to §V? |
| --- | ----------- | ---------- | --------------- |
