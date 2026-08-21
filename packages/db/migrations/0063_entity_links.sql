-- ============================================================
-- Migration: 0063_entity_links
-- Adds the entity_links table: user-added "title -> URL" reference
-- links attached to a ticket, shown in the record-detail Links tab
-- alongside Attachments.
-- ============================================================
--
-- DOWN MIGRATION (rollback):
-- DROP POLICY IF EXISTS "entity_links_tenant_isolation" ON "entity_links";
-- ALTER TABLE "entity_links" DISABLE ROW LEVEL SECURITY;
-- DROP INDEX IF EXISTS "entity_links_tenant_entity_idx";
-- DROP TABLE IF EXISTS "entity_links";
--
-- analytics: excluded (arbitrary user-entered titles/URLs, no aggregate
--            reporting need; entity association already covered via
--            entity_instances)

CREATE TABLE "entity_links" (
  "id"         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"  uuid        NOT NULL,
  "entity_id"  uuid        NOT NULL,
  "title"      text        NOT NULL,
  "url"        text        NOT NULL,
  "created_by" text        NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- Lookup: all links attached to a specific entity instance
CREATE INDEX "entity_links_tenant_entity_idx"
  ON "entity_links" ("tenant_id", "entity_id");

ALTER TABLE "entity_links" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "entity_links_tenant_isolation"
  ON "entity_links"
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE 'GRANT SELECT, INSERT, DELETE ON entity_links TO app_user';
  END IF;
END
$$;
