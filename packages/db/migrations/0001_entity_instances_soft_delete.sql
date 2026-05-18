-- Down migration:
-- ALTER TABLE "entity_instances" DROP COLUMN "deleted_at";
-- DROP INDEX IF EXISTS "entity_instances_tenant_deleted_idx";

BEGIN;

ALTER TABLE "entity_instances"
  ADD COLUMN "deleted_at" timestamp with time zone;

CREATE INDEX "entity_instances_tenant_deleted_idx"
  ON "entity_instances" USING btree ("tenant_id", "deleted_at");

COMMIT;
