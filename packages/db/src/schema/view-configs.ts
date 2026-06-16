import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export const viewConfigs = pgTable(
  "view_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    entityTypeSlug: text("entity_type_slug").notNull(),
    listColumns: jsonb("list_columns").default([]).notNull(),
    detailLayout: jsonb("detail_layout").default([]).notNull(),
    formFieldOrder: jsonb("form_field_order").default([]).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uniqueTenantEntity: unique("view_configs_tenant_entity_unique").on(
      t.tenantId,
      t.entityTypeSlug,
    ),
  }),
);
export type ViewConfig = typeof viewConfigs.$inferSelect;
export type NewViewConfig = typeof viewConfigs.$inferInsert;
