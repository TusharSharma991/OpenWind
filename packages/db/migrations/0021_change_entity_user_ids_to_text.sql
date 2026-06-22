-- Down migration:
-- ALTER TABLE "entity_instances" ALTER COLUMN "created_by" TYPE uuid USING "created_by"::uuid;
-- ALTER TABLE "entity_instances" ALTER COLUMN "assigned_to" TYPE uuid USING "assigned_to"::uuid;

ALTER TABLE "entity_instances" ALTER COLUMN "created_by" TYPE text USING "created_by"::text;
ALTER TABLE "entity_instances" ALTER COLUMN "assigned_to" TYPE text USING "assigned_to"::text;