-- analytics: excluded (backfill of existing rows only — no new table)
--
-- docs/specs/oncall-routing.md / team-assign-oncall-fallback.md gap: seed SQL
-- (modules/helpdesk/seed/*.sql) and the "Team-assign sync, 2026-09-21" entity
-- type auto-seed hook (packages/entity-engine/src/entity-types.ts) only run
-- ONCE per tenant/entity-type, at install/create time. Any tenant that
-- installed helpdesk, or created an entity type, BEFORE these were added
-- never received them — silently breaking on-call auto-assignment
-- end-to-end (resolve_oncall's automation rules never existed, and even when
-- they did, team_id was stripped from every entity's `fields` by entity-
-- engine's two-phase validation because it was never a declared
-- entity_fields row). This migration backfills all three gaps for every
-- existing tenant, matching each seed's own idempotent WHERE NOT EXISTS
-- pattern so it is safe to run against a tenant that already has some or
-- all of these.
--
-- Rollback: none provided — these are backfilled rows indistinguishable
-- from normally-seeded ones once inserted (same as any other seed-SQL
-- rollback in this codebase); removing them would require hand-identifying
-- rows by name/entity_type, which is safer done manually if ever needed.

-- 1) team_id entity field — every existing per-tenant, custom-fields-allowed
--    entity type that predates the 2026-09-21 auto-seed hook. Same shape as
--    entity-types.ts's addEntityField call (fieldType "text", not
--    "entity_ref" — teams is a plain lookup table, not an entity type).
INSERT INTO entity_fields (
  entity_type_id, tenant_id, name, label, field_type, config,
  is_required, is_indexed, is_system, sort_order, sensitivity
)
SELECT
  et.id, et.tenant_id, 'team_id', 'Team', 'text', '{}'::jsonb,
  false, true, false, 1, 'public'
FROM entity_types et
WHERE et.tenant_id IS NOT NULL
  AND et.allow_custom_fields = true
  AND NOT EXISTS (
    SELECT 1 FROM entity_fields ef
    WHERE ef.entity_type_id = et.id AND ef.name = 'team_id'
  );

-- 2) severity entity field — every existing tenant's 'ticket' entity type
--    that predates 001_entity_types.sql's severity field addition (ADR-016).
--    Only targets entity types actually named 'ticket' (helpdesk-specific
--    field, unlike team_id's generic auto-seed above).
INSERT INTO entity_fields (
  entity_type_id, tenant_id, name, label, field_type, config,
  is_required, is_indexed, is_system, sort_order
)
SELECT
  et.id, et.tenant_id, 'severity', 'Severity', 'select',
  '{"options": ["critical", "high", "medium", "low"]}'::jsonb,
  false, true, true, 5
FROM entity_types et
WHERE et.name = 'ticket'
  AND et.tenant_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM entity_fields ef
    WHERE ef.entity_type_id = et.id AND ef.name = 'severity'
  );

-- 3) resolve_oncall / dispatch_severity_notification automation rules —
--    every existing tenant with helpdesk installed, exact same shape as
--    modules/helpdesk/seed/003_automation_rules.sql's 4 rule inserts.
INSERT INTO automation_rules (id, tenant_id, name, is_enabled, trigger_type, trigger_config, conditions, actions, priority)
SELECT
  gen_random_uuid(),
  t.id,
  'Auto-assign on-call user when team is set on ticket creation',
  true,
  'entity.created',
  '{"entityType": "ticket"}'::jsonb,
  NULL,
  '[{"type": "resolve_oncall", "config": {}}]'::jsonb,
  0
FROM tenants t
WHERE t.config -> 'installed_modules' @> '"helpdesk"'::jsonb
  AND NOT EXISTS (
    SELECT 1 FROM automation_rules ar
    WHERE ar.tenant_id = t.id
      AND ar.name = 'Auto-assign on-call user when team is set on ticket creation'
  );

INSERT INTO automation_rules (id, tenant_id, name, is_enabled, trigger_type, trigger_config, conditions, actions, priority)
SELECT
  gen_random_uuid(),
  t.id,
  'Auto-assign on-call user when ticket team changes',
  true,
  'entity.updated',
  '{"entityType": "ticket"}'::jsonb,
  NULL,
  '[{"type": "resolve_oncall", "config": {}}]'::jsonb,
  0
FROM tenants t
WHERE t.config -> 'installed_modules' @> '"helpdesk"'::jsonb
  AND NOT EXISTS (
    SELECT 1 FROM automation_rules ar
    WHERE ar.tenant_id = t.id
      AND ar.name = 'Auto-assign on-call user when ticket team changes'
  );

INSERT INTO automation_rules (id, tenant_id, name, is_enabled, trigger_type, trigger_config, conditions, actions, priority)
SELECT
  gen_random_uuid(),
  t.id,
  'Dispatch severity notification on ticket creation',
  true,
  'entity.created',
  '{"entityType": "ticket"}'::jsonb,
  NULL,
  '[{"type": "dispatch_severity_notification", "config": {}}]'::jsonb,
  0
FROM tenants t
WHERE t.config -> 'installed_modules' @> '"helpdesk"'::jsonb
  AND NOT EXISTS (
    SELECT 1 FROM automation_rules ar
    WHERE ar.tenant_id = t.id
      AND ar.name = 'Dispatch severity notification on ticket creation'
  );

INSERT INTO automation_rules (id, tenant_id, name, is_enabled, trigger_type, trigger_config, conditions, actions, priority)
SELECT
  gen_random_uuid(),
  t.id,
  'Dispatch severity notification when ticket severity changes',
  true,
  'entity.updated',
  '{"entityType": "ticket"}'::jsonb,
  NULL,
  '[{"type": "dispatch_severity_notification", "config": {}}]'::jsonb,
  0
FROM tenants t
WHERE t.config -> 'installed_modules' @> '"helpdesk"'::jsonb
  AND NOT EXISTS (
    SELECT 1 FROM automation_rules ar
    WHERE ar.tenant_id = t.id
      AND ar.name = 'Dispatch severity notification when ticket severity changes'
  );
