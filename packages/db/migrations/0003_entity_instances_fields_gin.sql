-- Down migration:
-- DROP INDEX IF EXISTS "entity_instances_fields_gin_idx";

CREATE INDEX "entity_instances_fields_gin_idx"
  ON "entity_instances" USING gin("fields" jsonb_path_ops);
