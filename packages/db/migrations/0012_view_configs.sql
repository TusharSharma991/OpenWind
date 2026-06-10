-- ============================================================
-- Migration: 0012_view_configs
-- Per-tenant UI view configuration for generic entity list/
-- detail/form rendering.
-- ============================================================
--
-- DOWN MIGRATION (rollback):
-- DROP POLICY IF EXISTS "view_configs_tenant_isolation" ON "view_configs";
-- ALTER TABLE "view_configs" DISABLE ROW LEVEL SECURITY;
-- DROP INDEX IF EXISTS "view_configs_tenant_slug_idx";
-- DROP TABLE IF EXISTS "view_configs";
--
-- analytics: included(id,tenant_id,entity_type_slug,created_at,updated_at)
-- list_columns, detail_layout, form_field_order are excluded from analytics
-- (UI config has no analytical value)

CREATE TABLE "view_configs" (
  "id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"        uuid        NOT NULL,
  "entity_type_slug" text        NOT NULL,
  "list_columns"     jsonb       NOT NULL DEFAULT '[]',
  -- [{ field: string, label: string, width?: number, sortable?: boolean }]
  "detail_layout"    jsonb       NOT NULL DEFAULT '[]',
  -- [{ group: string, fields: string[] }]
  "form_field_order" jsonb       NOT NULL DEFAULT '[]',
  -- [field_slug, ...]
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "view_configs_tenant_slug_unique"
    UNIQUE ("tenant_id", "entity_type_slug")
);

-- Lookup: view config for a specific tenant + entity type (primary access pattern)
CREATE INDEX "view_configs_tenant_slug_idx"
  ON "view_configs" ("tenant_id", "entity_type_slug");

ALTER TABLE "view_configs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view_configs_tenant_isolation"
  ON "view_configs"
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON view_configs TO app_user';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analytics_user') THEN
    EXECUTE 'GRANT SELECT (id, tenant_id, entity_type_slug, created_at, updated_at) ON view_configs TO analytics_user';
  END IF;
END
$$;
