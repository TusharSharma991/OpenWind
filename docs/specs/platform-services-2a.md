# Platform Services — 2A

> Cross-cutting services every module depends on: notifications, file storage, audit log, view configs, OpenAPI spec.

status: draft
created: 2026-05-22
updated: 2026-05-22
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

| constraint             | value                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| stack                  | Novu (notifications), S3/MinIO (files), ClamAV or cloud AV (scanning), Drizzle, Hono, `@hono/zod-openapi` |
| auth                   | All endpoints require JWT; file access validates tenant ownership before signing                          |
| notification templates | Defined in Novu, never in TypeScript — config-first invariant                                             |
| audit log              | Append-only at DB level: no UPDATE/DELETE RLS policy on `admin_audit_log`                                 |
| out of scope           | Email template builder UI (Phase 3); per-field audit diff (Phase 3); Metabase integration (2D)            |
| depends on             | #7 (1A infra), #8 (1B auth) complete                                                                      |

---

## §I Interfaces

### `@platform/notifications`

```typescript
sendNotification(tenantId: string, userId: string, templateId: string, payload: Record<string, unknown>): Promise<void>
getUserPreferences(tenantId: string, userId: string): Promise<NotificationPreferences>
updateUserPreferences(tenantId: string, userId: string, prefs: Partial<NotificationPreferences>): Promise<void>
```

### `@platform/files`

```typescript
initiateUpload(tenantId: string, moduleSlug: string, entityId: string, filename: string, mimeType: string, sizeBytes: number): Promise<{ uploadUrl: string; fileId: string }>
getDownloadUrl(tenantId: string, fileId: string): Promise<{ downloadUrl: string; expiresAt: Date }>
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
  scan_status TEXT NOT NULL DEFAULT 'pending',  -- pending | clean | quarantined
  uploaded_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
✓ Unknown `templateId` returns a typed error, does not silently drop

R2: Users can read and update their notification channel preferences (email, in-app, SMS) via the preferences API.
✓ `GET /preferences/notifications` returns current preferences
✓ `PATCH /preferences/notifications` persists changes; subsequent GET reflects update

R3: Novu digest batching is supported — the `notify` call passes enough metadata for Novu digest workflows to group notifications.
✓ `sendNotification` accepts an optional `digestKey` field; passed to Novu as digest group key when present

**Files**

R4: Upload flow is two-step: platform issues presigned URL, client uploads directly to S3, platform records metadata.
✓ `POST /files` returns `{ uploadUrl, fileId }` without touching file bytes
✓ File metadata row exists in `files` table immediately after `POST /files` with `scan_status = 'pending'`

R5: All file access is tenant-scoped. A tenant cannot access files belonging to another tenant.
✓ `GET /files/:id` returns 404 for a valid file ID that belongs to a different tenant
✓ S3 paths include `tenantId` prefix — direct bucket access without a signed URL is blocked at bucket policy level

R6: File uploads are checked for malware asynchronously. Infected files are quarantined and not served.
✓ After upload, a background job runs AV scan; `scan_status` transitions `pending → clean | quarantined`
✓ `GET /files/:id` on a quarantined file returns 422 with reason; never issues a download URL
✓ Tenant admin receives a notification when a file is quarantined

R7: Storage quota is enforced per tenant at upload time.
✓ `POST /files` returns 422 if `sum(size_bytes) + new file size > tenant_config.storage_quota_mb * 1MB`
✓ Quota check is transactional — two concurrent uploads cannot both exceed quota

**Audit log**

R8: Every entity create, update, delete, and workflow transition is captured in `admin_audit_log`.
✓ After `POST /entities/:typeId`, a row exists in `admin_audit_log` with action=created, correct actor, before=null, after=entity snapshot
✓ After `POST /entities/:id/transitions`, a row exists with action=transitioned, before/after state captured
✓ Audit writes are in the same transaction as the entity mutation — no orphaned mutations without audit entries

R9: `admin_audit_log` is immutable at the database level.
✓ Attempting `UPDATE admin_audit_log SET ...` as any role (including superuser-adjacent) is blocked by RLS
✓ Attempting `DELETE FROM admin_audit_log` is blocked by RLS

R10: Audit log is queryable by tenantId, actorId, resourceType, resourceId, and date range with cursor pagination.
✓ `GET /admin/audit?resourceType=ticket&from=2026-01-01` returns matching rows
✓ Response includes a cursor for the next page; page size max 100

**View configs**

R11: Module seed SQL sets default `view_configs` rows for each entity type. Tenants can override per entity type.
✓ After installing helpdesk module, `view_configs` has a row for `ticket` with sensible list/detail/form defaults
✓ `PATCH /admin/view-configs/ticket` persists tenant override; subsequent GET returns overridden config
✓ Override does not affect other tenants' view configs for the same entity type

**OpenAPI**

R12: `GET /openapi.json` returns a valid OpenAPI 3.1 spec derived from Zod validators, with no manual maintenance.
✓ Adding a new route with a Zod validator causes it to appear in the spec without manual edits
✓ Spec includes auth requirements (JWT bearer) on all protected routes

---

## §V Invariants

- Files are never served via direct S3 URLs — always presigned, always tenant-validated
- Audit log rows are written in the same transaction as the mutation they describe
- `admin_audit_log` has no UPDATE or DELETE RLS policy — append-only is enforced at DB, not application level
- Notification templates live in Novu, never in platform TypeScript
- `view_configs` has one row per (tenant, entity_type) — UNIQUE constraint enforced
- PII field values in `before_snapshot`/`after_snapshot` are redacted per `entity_fields.sensitivity` (see ssrf-pii-hardening spec)

---

## §T Tasks

| id  | task                                                                                                                   | phase | status | depends         |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ----- | ------ | --------------- |
| T1  | Migration: `files` table + RLS + indexes                                                                               | 1     | todo   | —               |
| T2  | Migration: `admin_audit_log` table + append-only RLS + indexes                                                         | 1     | todo   | —               |
| T3  | Migration: `view_configs` table + RLS + unique constraint                                                              | 1     | todo   | —               |
| T4  | `@platform/notifications` package: `sendNotification`, `getUserPreferences`, `updateUserPreferences` wrapping Novu SDK | 1     | todo   | —               |
| T5  | `@platform/files` package: `initiateUpload`, `getDownloadUrl`; S3 path convention; quota check                         | 1     | todo   | T1              |
| T6  | `@platform/audit` package: `writeAuditEntry`; middleware that hooks entity create/update/delete/transition             | 1     | todo   | T2              |
| T7  | File routes: `POST /files`, `GET /files/:id`, `DELETE /files/:id`                                                      | 2     | todo   | T5              |
| T8  | AV scan background job (BullMQ); quarantine flow; tenant notification on quarantine                                    | 2     | todo   | T5,T4           |
| T9  | Audit log routes: `GET /admin/audit` with filtering + cursor pagination                                                | 2     | todo   | T6              |
| T10 | Notification preferences routes: `GET /preferences/notifications`, `PATCH /preferences/notifications`                  | 2     | todo   | T4              |
| T11 | View configs routes: `GET /admin/view-configs/:entityType`, `PATCH /admin/view-configs/:entityType`                    | 2     | todo   | T3              |
| T12 | Wire `@hono/zod-openapi`; `GET /openapi.json` route                                                                    | 2     | todo   | —               |
| T13 | Unit tests: quota enforcement, scan flow state machine, audit write atomicity, view config isolation                   | 3     | todo   | T5,T6,T7,T8,T11 |
| T14 | Isolation tests: cross-tenant file access (expect 404), cross-tenant audit log, cross-tenant view config               | 3     | todo   | T7,T9,T11       |

phase gate: all unit + integration tests pass before advancing to next phase

## §B Bugs / Backprop Log

| id  | what failed | root cause | promoted to §V? |
| --- | ----------- | ---------- | --------------- |
