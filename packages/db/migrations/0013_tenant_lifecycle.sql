-- analytics: excluded (tenant lifecycle columns — internal platform metadata, no analytics value)

-- DOWN
-- ALTER TABLE tenants DROP COLUMN IF EXISTS suspended_at;
-- ALTER TABLE tenants DROP COLUMN IF EXISTS deletion_scheduled_at;

BEGIN;

ALTER TABLE tenants
  ADD COLUMN suspended_at         TIMESTAMPTZ,
  ADD COLUMN deletion_scheduled_at TIMESTAMPTZ;

COMMENT ON COLUMN tenants.suspended_at          IS 'Set when status transitions to suspended; cleared on reactivation.';
COMMENT ON COLUMN tenants.deletion_scheduled_at IS 'When the GDPR purge job will hard-delete all tenant data (default: 30 days after DELETE request).';

-- Index for the purge worker: find tenants due for deletion
CREATE INDEX tenants_deletion_due_idx
  ON tenants (deletion_scheduled_at)
  WHERE deletion_scheduled_at IS NOT NULL AND status = 'deleted';

-- M2: extend CHECK constraint to allow 'purged' (set by the purge worker)
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_status_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_status_check
  CHECK (status IN ('provisioning', 'active', 'suspended', 'deleted', 'purged'));

COMMIT;
