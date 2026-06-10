-- ============================================================
-- Migration: 0010_files
-- Adds the files table for tenant-scoped file storage with
-- AV scan status tracking.
-- ============================================================
--
-- DOWN MIGRATION (rollback):
-- DROP POLICY IF EXISTS "files_tenant_isolation" ON "files";
-- ALTER TABLE "files" DISABLE ROW LEVEL SECURITY;
-- DROP INDEX IF EXISTS "files_tenant_scan_idx";
-- DROP INDEX IF EXISTS "files_tenant_entity_idx";
-- DROP TABLE IF EXISTS "files";
--
-- analytics: excluded (files metadata may contain PII via original_name
--            and entity association; managed via a separate reporting view
--            when needed)

CREATE TABLE "files" (
  "id"            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"     uuid        NOT NULL,
  "module_slug"   text        NOT NULL,
  "entity_id"     uuid,
  "original_name" text        NOT NULL,
  "storage_key"   text        NOT NULL,       -- S3 path: {tenantId}/{moduleSlug}/{entityId}/{uuid}-{filename}
  "mime_type"     text        NOT NULL,
  "size_bytes"    bigint      NOT NULL CHECK ("size_bytes" > 0),
  "scan_status"   text        NOT NULL DEFAULT 'pending'
                              CONSTRAINT "files_scan_status_check"
                              CHECK ("scan_status" IN ('pending', 'clean', 'quarantined', 'scan_failed', 'deleted')),
  "uploaded_by"   uuid        NOT NULL,       -- Zitadel user UUID
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now()
);

-- Lookup: all files for a tenant in a given scan state (quota queries, purge job)
CREATE INDEX "files_tenant_scan_idx"
  ON "files" ("tenant_id", "scan_status");

-- Lookup: all files attached to a specific entity instance
CREATE INDEX "files_tenant_entity_idx"
  ON "files" ("tenant_id", "entity_id")
  WHERE "entity_id" IS NOT NULL;

ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "files_tenant_isolation"
  ON "files"
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON files TO app_user';
  END IF;
END
$$;
