-- down:
--   ALTER TABLE entity_instances DROP COLUMN IF EXISTS remark;

-- System-level free-text remark, captured at ticket creation alongside
-- assigned_to/due_date (see 0052_entity_instances_due_date.sql) rather than as
-- a per-entity-type custom field, so every workflow's create form gets the
-- same "Remark" box without per-module seed changes.
ALTER TABLE entity_instances
  ADD COLUMN IF NOT EXISTS remark TEXT;
