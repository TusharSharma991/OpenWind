import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
  unique,
  boolean,
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

export const modules = pgTable("modules", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  version: text("version").notNull(),
  isSystem: boolean("is_system").default(false).notNull(),
  minPlan: text("min_plan").default("standard").notNull(),
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
    /** Email from JWT — updated on each login */
    email: text("email"),
    /** Display name from JWT name/given_name claim — updated on each login */
    displayName: text("display_name"),
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
