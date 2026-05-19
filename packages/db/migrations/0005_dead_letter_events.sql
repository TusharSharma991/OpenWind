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
