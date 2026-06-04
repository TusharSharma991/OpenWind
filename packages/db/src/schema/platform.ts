import {
  pgTable,
  uuid,
  text,
  jsonb,
  bigint,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: text("plan").default("standard").notNull(),
  // Lifecycle: provisioning → active → suspended → deleted
  // text + CHECK (see migration 0001) so new states don't require ALTER TYPE
  status: text("status").default("active").notNull(),
  config: jsonb("config").default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    scopes: text("scopes").array().default([]).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    tenantIdx: index("api_keys_tenant_idx").on(t.tenantId),
  }),
);

/**
 * tenant_users — shadow table that records every user who has successfully
 * authenticated into a tenant.  Populated by a fire-and-forget upsert in the
 * requireAuth JWT path; used by the entity engine to validate user_ref fields
 * cross-tenant (a user_ref UUID must resolve to a user in the same tenant).
 *
 * RLS: enforced via app.tenant_id GUC, consistent with other tenant tables.
 * The auth middleware upsert runs inside withTenantContext so the GUC is set.
 */
export const tenantUsers = pgTable(
  "tenant_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    /** External user ID — Zitadel JWT sub claim value */
    userId: text("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    // No explicit index needed — the uniqueTenantUser unique constraint below
    // automatically creates a backing B-tree index on (tenant_id, user_id),
    // which serves as the primary lookup pattern.
    uniqueTenantUser: unique("tenant_users_tenant_user_unique").on(
      t.tenantId,
      t.userId,
    ),
  }),
);

/**
 * files — tenant-scoped file metadata with AV scan status tracking.
 * Actual file bytes live in S3; this table tracks the lifecycle.
 * RLS: enforced via app.tenant_id GUC.
 */
export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    moduleSlug: text("module_slug").notNull(),
    entityId: uuid("entity_id"),
    originalName: text("original_name").notNull(),
    /** S3 path: {tenantId}/{moduleSlug}/{entityId}/{uuid}-{filename} */
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    /** pending | clean | quarantined | scan_failed | deleted */
    scanStatus: text("scan_status").default("pending").notNull(),
    uploadedBy: uuid("uploaded_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    tenantScanIdx: index("files_tenant_scan_idx").on(t.tenantId, t.scanStatus),
    tenantEntityIdx: index("files_tenant_entity_idx").on(
      t.tenantId,
      t.entityId,
    ),
  }),
);

/**
 * adminAuditLog — append-only audit log for all entity mutations.
 * GRANT: INSERT + SELECT only for app_user; no UPDATE or DELETE.
 * RLS: USING only policy (app_user cannot read rows outside their tenant).
 */
export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    actorId: text("actor_id").notNull(),
    /** user | api_key | system */
    actorType: text("actor_type").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id").notNull(),
    /** created | updated | deleted | transitioned | restored */
    action: text("action").notNull(),
    /** null for create actions; PII-redacted */
    beforeSnapshot: jsonb("before_snapshot"),
    /** null for delete actions; PII-redacted */
    afterSnapshot: jsonb("after_snapshot"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    tenantResourceIdx: index("audit_log_tenant_resource_idx").on(
      t.tenantId,
      t.resourceType,
      t.resourceId,
    ),
    tenantActorIdx: index("audit_log_tenant_actor_idx").on(
      t.tenantId,
      t.actorId,
    ),
    tenantCreatedIdx: index("audit_log_tenant_created_idx").on(
      t.tenantId,
      t.createdAt,
    ),
  }),
);

/**
 * viewConfigs — per-tenant UI configuration for entity list/detail/form.
 * Unique per (tenant, entity_type_slug). Module seeds use ON CONFLICT DO NOTHING
 * so tenant overrides are never clobbered by reinstalls.
 */
export const viewConfigs = pgTable(
  "view_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    entityTypeSlug: text("entity_type_slug").notNull(),
    /** [{ field, label, width?, sortable? }] */
    listColumns: jsonb("list_columns").default([]).notNull(),
    /** [{ group, fields[] }] */
    detailLayout: jsonb("detail_layout").default([]).notNull(),
    /** [field_slug, ...] */
    formFieldOrder: jsonb("form_field_order").default([]).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    tenantSlugUnique: unique("view_configs_tenant_slug_unique").on(
      t.tenantId,
      t.entityTypeSlug,
    ),
  }),
);

export const connectorCredentials = pgTable(
  "connector_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    connectorId: text("connector_id").notNull(),
    credentials: text("credentials").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    tenantIdx: index("connector_credentials_tenant_idx").on(
      t.tenantId,
      t.connectorId,
    ),
  }),
);
