-- Down migration (rollback):
-- ALTER TABLE "workflows" DROP COLUMN IF EXISTS "is_active";

ALTER TABLE "workflows"
  ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true;
