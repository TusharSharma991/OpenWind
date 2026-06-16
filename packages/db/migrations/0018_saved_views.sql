-- ============================================================
-- Migration: 0018_saved_views
-- Per-user saved filter/sort views for entity list pages.
-- Scoped by both tenant_id (RLS) and user_id (Zitadel subject).
-- ============================================================
--
-- DOWN MIGRATION (rollback):
-- DROP POLICY IF EXISTS "saved_views_user_isolation" ON "saved_views";
-- ALTER TABLE "saved_views" DISABLE ROW LEVEL SECURITY;
-- DROP INDEX IF EXISTS "saved_views_tenant_user_type_idx";
-- DROP INDEX IF EXISTS "saved_views_tenant_type_idx";
-- DROP TABLE IF EXISTS "saved_views";
--
-- analytics: included(id, tenant_id, user_id, entity_type_id, name, created_at)

CREATE TABLE "saved_views" (
  "id"             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"      uuid        NOT NULL,
  "user_id"        text        NOT NULL,   -- Zitadel JWT sub claim
  "entity_type_id" uuid        NOT NULL
                               REFERENCES "entity_types"("id") ON DELETE CASCADE,
  "name"           text        NOT NULL
                               CONSTRAINT "saved_views_name_length"
                               CHECK (char_length("name") <= 60),
  "filter_config"  jsonb       NOT NULL DEFAULT '{}',
  "sort_config"    jsonb       NOT NULL DEFAULT '{}',
  "is_default"     boolean     NOT NULL DEFAULT false,
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now()
);

-- Primary lookup: all views for a user on a specific entity type
CREATE INDEX "saved_views_tenant_user_type_idx"
  ON "saved_views" ("tenant_id", "user_id", "entity_type_id");

-- Secondary lookup: all views for an entity type in a tenant (admin reporting)
CREATE INDEX "saved_views_tenant_type_idx"
  ON "saved_views" ("tenant_id", "entity_type_id");

ALTER TABLE "saved_views" ENABLE ROW LEVEL SECURITY;

-- RLS requires both tenant isolation AND user isolation.
-- The user_id GUC is set by the auth middleware alongside app.tenant_id.
CREATE POLICY "saved_views_user_isolation"
  ON "saved_views"
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND user_id = current_setting('app.user_id', true)
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND user_id = current_setting('app.user_id', true)
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON saved_views TO app_user';
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analytics_user') THEN
    EXECUTE 'GRANT SELECT (id, tenant_id, user_id, entity_type_id, name, created_at) ON saved_views TO analytics_user';
  END IF;
END
$$;
