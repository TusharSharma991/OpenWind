-- analytics: excluded (catalog reference data, not tenant/usage data)
--
-- Seeds the 8 standard modules into the read-only `modules` catalog
-- (migration 0066 revoked app_user's INSERT/UPDATE on this table --
-- issue #404, "read-only catalog" -- so this can never be done from
-- application runtime code as a pooled app_user connection; it has to be a
-- migration, run as migration_user like any other DDL/catalog change).
--
-- Previously ModuleService.seedRegistry() (apps/api/src/services/
-- module-service.ts) tried to do this same upsert at API startup and on
-- every empty-registry read, using the ordinary app_user `db` client --
-- silently failing with "permission denied for table modules" since
-- migration 0066 first ran, non-fatal only because the table already had
-- rows from before that grant was revoked. Removed as part of this fix
-- (see that file's own comment) -- the catalog is now migration-owned,
-- consistent with connector_definitions/plugin_definitions never having a
-- runtime auto-seed path either.
--
-- ON CONFLICT DO UPDATE (not DO NOTHING) so re-running this file's logic
-- after a future edit to the list below (new description, version bump)
-- via a later migration stays possible without a separate UPDATE migration
-- each time -- matches ModuleService.seedRegistry()'s original upsert
-- semantics exactly, just moved to the correct privilege boundary.
--
-- Rollback (undoes only what THIS migration added -- leaves the row if it
-- pre-existed, since this can't distinguish "I inserted this" from
-- "already there before this migration ran"):
--   DELETE FROM modules WHERE slug IN (
--     'helpdesk', 'crm', 'hrms', 'reimbursements', 'projects', 'invoicing',
--     'procurement', 'tender'
--   );

INSERT INTO modules (slug, name, description, version, is_system, min_plan, category)
VALUES
  ('helpdesk', 'Helpdesk', 'Support ticket management with priority, SLA, and category tracking', '0.0.1', false, 'standard', 'core'),
  ('crm', 'CRM', 'Sales pipeline and deal tracking from lead to close', '0.0.1', false, 'standard', 'core'),
  ('hrms', 'HRMS', 'Leave request and employee workflow management', '0.0.1', false, 'standard', 'core'),
  ('reimbursements', 'Reimbursements', 'Expense claim submission, approval, and payment tracking', '0.0.1', false, 'standard', 'core'),
  ('projects', 'Projects', 'Task and project tracking with backlog, sprint, and review stages', '0.0.1', false, 'standard', 'core'),
  ('invoicing', 'Invoicing', 'Invoice lifecycle from draft through sent, viewed, to paid', '0.0.1', false, 'standard', 'core'),
  ('procurement', 'Procurement', 'Purchase order requests, approvals, and delivery tracking', '0.0.1', false, 'standard', 'core'),
  ('tender', 'Tender Management', 'Tender lifecycle from draft through BOQ, isolated costing review, and submission', '0.0.1', false, 'standard', 'optional')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  version = EXCLUDED.version,
  is_system = EXCLUDED.is_system,
  min_plan = EXCLUDED.min_plan,
  category = EXCLUDED.category,
  updated_at = now();
