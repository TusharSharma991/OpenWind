-- ============================================================
-- Migration: 0011_admin_audit_log
-- Append-only audit log for all entity mutations and admin
-- operations. No UPDATE/DELETE granted to any application role.
-- ============================================================
--
-- DOWN MIGRATION (rollback):
-- DROP POLICY IF EXISTS "audit_log_tenant_isolation" ON "admin_audit_log";
-- ALTER TABLE "admin_audit_log" DISABLE ROW LEVEL SECURITY;
-- DROP INDEX IF EXISTS "audit_log_tenant_resource_idx";
-- DROP INDEX IF EXISTS "audit_log_tenant_actor_idx";
-- DROP INDEX IF EXISTS "audit_log_tenant_created_idx";
-- DROP TABLE IF EXISTS "admin_audit_log";
--
-- analytics: included(id,tenant_id,actor_id,actor_type,resource_type,
--            resource_id,action,created_at,metadata)
-- before_snapshot and after_snapshot are excluded from analytics —
-- they may contain PII even after redaction at the application layer.

CREATE TABLE "admin_audit_log" (
  "id"              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"       uuid        NOT NULL,
  "actor_id"        text        NOT NULL,     -- user UUID or 'system' or api key id
  "actor_type"      text        NOT NULL
                                CONSTRAINT "audit_log_actor_type_check"
                                CHECK ("actor_type" IN ('user', 'api_key', 'system')),
  "resource_type"   text        NOT NULL,     -- entity type slug, e.g. 'ticket'
  "resource_id"     uuid        NOT NULL,
  "action"          text        NOT NULL
                                CONSTRAINT "audit_log_action_check"
                                CHECK ("action" IN ('created', 'updated', 'deleted', 'transitioned', 'restored')),
  "before_snapshot" jsonb,                    -- null for create actions
  "after_snapshot"  jsonb,                    -- null for delete actions
  "metadata"        jsonb,                    -- transition name, bulk batch id, etc.
  "created_at"      timestamptz NOT NULL DEFAULT now()
  -- No updated_at — this table is append-only by design
);

-- Primary query patterns
CREATE INDEX "audit_log_tenant_resource_idx"
  ON "admin_audit_log" ("tenant_id", "resource_type", "resource_id");

CREATE INDEX "audit_log_tenant_actor_idx"
  ON "admin_audit_log" ("tenant_id", "actor_id");

CREATE INDEX "audit_log_tenant_created_idx"
  ON "admin_audit_log" ("tenant_id", "created_at" DESC);

ALTER TABLE "admin_audit_log" ENABLE ROW LEVEL SECURITY;

-- RLS USING only — app_user can INSERT rows that pass the check,
-- but UPDATE/DELETE are blocked at the GRANT level below (not via RLS).
-- This is intentional: RLS on INSERT without WITH CHECK means the
-- inserted row must match the USING predicate.
CREATE POLICY "audit_log_tenant_isolation"
  ON "admin_audit_log"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- app_user: INSERT + SELECT only — no UPDATE, no DELETE (append-only invariant)
-- analytics_user: SELECT only on non-PII columns (enforced by column-level grant in 0009)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE 'GRANT SELECT, INSERT ON admin_audit_log TO app_user';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analytics_user') THEN
    EXECUTE 'GRANT SELECT (id, tenant_id, actor_id, actor_type, resource_type, resource_id, action, created_at, metadata) ON admin_audit_log TO analytics_user';
  END IF;
END
$$;
