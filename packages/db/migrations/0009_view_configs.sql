-- Down migration (rollback):
-- DROP POLICY IF EXISTS "view_configs_tenant_isolation" ON "view_configs";
-- ALTER TABLE "view_configs" DISABLE ROW LEVEL SECURITY;
-- DROP TABLE IF EXISTS "view_configs";

CREATE TABLE "view_configs" (
  "id"                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         uuid        NOT NULL,
  "entity_type_slug"  text        NOT NULL,
  "list_columns"      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  "detail_layout"     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  "form_field_order"  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  "created_at"        timestamptz NOT NULL DEFAULT now(),
  "updated_at"        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "view_configs_tenant_entity_unique" UNIQUE ("tenant_id", "entity_type_slug")
);

ALTER TABLE "view_configs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view_configs_tenant_isolation"
  ON "view_configs"
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
