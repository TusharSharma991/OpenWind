-- Down migration (rollback):
-- DROP POLICY IF EXISTS "dead_letter_events_tenant_isolation" ON "dead_letter_events";
-- ALTER TABLE "dead_letter_events" DISABLE ROW LEVEL SECURITY;
-- DROP INDEX IF EXISTS "dead_letter_events_tenant_created_idx";
-- DROP TABLE IF EXISTS "dead_letter_events";
--
-- NOTE: The true flag on current_setting is intentional — it makes the function
-- return NULL (instead of raising an exception) when app.tenant_id is not set,
-- so tenant_id = NULL evaluates to false and safely blocks all rows rather than
-- crashing migration scripts and background jobs that run outside a tenant context.

CREATE TABLE "dead_letter_events" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         uuid NOT NULL,
  "original_event_id" uuid REFERENCES "outbox_events"("id") ON DELETE SET NULL,
  "event_type"        text NOT NULL,
  "payload"           jsonb NOT NULL,
  "rule_id"           uuid REFERENCES "automation_rules"("id") ON DELETE SET NULL,
  "error"             text NOT NULL,
  "attempt_count"     integer NOT NULL,
  "created_at"        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "dead_letter_events_tenant_created_idx"
  ON "dead_letter_events" ("tenant_id", "created_at");

ALTER TABLE "dead_letter_events" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dead_letter_events_tenant_isolation"
  ON "dead_letter_events"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
