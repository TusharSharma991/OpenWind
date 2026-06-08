-- Down migration (rollback):
-- DROP POLICY IF EXISTS "tenant_users_tenant_isolation" ON "tenant_users";
-- ALTER TABLE "tenant_users" DISABLE ROW LEVEL SECURITY;
-- DROP TABLE IF EXISTS "tenant_users";

-- analytics: excluded (user_id is PII under GDPR; see ADR-001 analytics access policy)

-- tenant_users is a shadow table populated by the auth middleware on every
-- successful JWT verification (fire-and-forget INSERT ON CONFLICT DO NOTHING).
-- It is used exclusively by the entity engine to validate user_ref field values:
-- a user_ref UUID must resolve to a user who has authenticated into the tenant.
-- It is never directly client-queryable; no public API surface exposes it.

CREATE TABLE "tenant_users" (
  "id"         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"  uuid        NOT NULL,
  "user_id"    text        NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "tenant_users_tenant_user_unique" UNIQUE ("tenant_id", "user_id")
  -- The UNIQUE constraint above automatically creates a B-tree index on
  -- (tenant_id, user_id), which also serves the primary lookup pattern.
  -- No separate CREATE INDEX is needed.
);

ALTER TABLE "tenant_users" ENABLE ROW LEVEL SECURITY;

-- Auth middleware upserts run inside withTenantContext which sets the GUC.
-- The true flag makes current_setting return NULL (not raise) when unset,
-- so infrastructure background tasks that skip tenant context are safely
-- blocked rather than crashing.
CREATE POLICY "tenant_users_tenant_isolation"
  ON "tenant_users"
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
