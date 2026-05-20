-- Down migration (rollback):
-- ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "tenant_read" ON "outbox_events"
--   FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
-- CREATE POLICY "tenant_write" ON "outbox_events"
--   FOR ALL
--   USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
--   WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
-- ALTER TABLE "dead_letter_events" ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "dead_letter_events_tenant_isolation" ON "dead_letter_events"
--   USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- outbox_events and dead_letter_events are internal bus tables consumed by the
-- worker process, which polls across ALL tenants in a single batch with no
-- tenant context set.  RLS on these tables filtered every row to zero (because
-- current_setting('app.tenant_id', true) returns NULL outside withTenantContext),
-- silently preventing any automation from running.  Tenant isolation for these
-- tables is enforced at the application layer:
--   • outbox_events  — written only inside withTenantContext with tenant_id NOT NULL
--   • dead_letter_events — written via withTenantContext in the worker
-- Neither table is ever directly client-queryable (no public API exposes them).

DROP POLICY IF EXISTS "tenant_read"                         ON "outbox_events";
DROP POLICY IF EXISTS "tenant_write"                        ON "outbox_events";
ALTER TABLE "outbox_events" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dead_letter_events_tenant_isolation" ON "dead_letter_events";
ALTER TABLE "dead_letter_events" DISABLE ROW LEVEL SECURITY;
