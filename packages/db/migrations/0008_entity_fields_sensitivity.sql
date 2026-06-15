-- ============================================================
-- Migration: 0008_entity_fields_sensitivity
-- Adds sensitivity classification to entity_fields for PII
-- redaction at workflow_events write time.
-- ============================================================
--
-- DOWN MIGRATION (rollback):
-- ALTER TABLE entity_fields DROP COLUMN sensitivity;
--
-- analytics: included(id,entity_type_id,tenant_id,name,label,
--            field_type,config,is_required,is_indexed,is_system,
--            sort_order,created_at,sensitivity)
-- (analytics_user grant is handled in migration 0009)

ALTER TABLE entity_fields
  ADD COLUMN sensitivity TEXT NOT NULL DEFAULT 'internal'
    CONSTRAINT entity_fields_sensitivity_check
    CHECK (sensitivity IN ('public', 'internal', 'pii', 'financial'));

COMMENT ON COLUMN entity_fields.sensitivity IS
  'PII classification for redaction: public | internal | pii | financial. '
  'Default: internal. Values for pii/financial fields are replaced with '
  '"[REDACTED]" when written to workflow_events.metadata.';
