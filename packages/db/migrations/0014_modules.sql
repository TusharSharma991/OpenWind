-- Down migration (rollback):
-- DROP TABLE IF EXISTS "modules";

-- analytics: excluded (platform-global registry — no tenant_id, no PII; not tenant-scoped)

CREATE TABLE "modules" (
  "id"          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "slug"        text        NOT NULL UNIQUE,
  "name"        text        NOT NULL,
  "description" text,
  "version"     text        NOT NULL,
  "is_system"   boolean     NOT NULL DEFAULT false,
  "min_plan"    text        NOT NULL DEFAULT 'standard',
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now()
);
