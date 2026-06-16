import {
  pgTable,
  uuid,
  text,
  jsonb,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const savedViews = pgTable(
  "saved_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    /** Zitadel JWT sub claim — set server-side from auth context, never from request body */
    userId: text("user_id").notNull(),
    entityTypeId: uuid("entity_type_id").notNull(),
    name: text("name").notNull(),
    filterConfig: jsonb("filter_config").default({}).notNull(),
    sortConfig: jsonb("sort_config").default({}).notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    tenantUserTypeIdx: index("saved_views_tenant_user_type_idx").on(
      t.tenantId,
      t.userId,
      t.entityTypeId,
    ),
    tenantTypeIdx: index("saved_views_tenant_type_idx").on(
      t.tenantId,
      t.entityTypeId,
    ),
  }),
);

export type SavedView = typeof savedViews.$inferSelect;
export type NewSavedView = typeof savedViews.$inferInsert;
