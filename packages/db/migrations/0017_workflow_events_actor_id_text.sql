-- Migration: change workflow_events.actor_id from uuid to text
-- Zitadel issues snowflake IDs (numeric strings) not UUIDs; uuid column rejects them.

-- Down:
-- ALTER TABLE workflow_events ALTER COLUMN actor_id TYPE uuid USING actor_id::uuid;

ALTER TABLE workflow_events ALTER COLUMN actor_id TYPE text USING actor_id::text;
