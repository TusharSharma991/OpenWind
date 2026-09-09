-- analytics: excluded (visibility flag, not an analytics dimension)
--
-- Adds an admin-only visibility flag to workflows. Some workflows are internal/test
-- configuration (e.g. a "Leave Approval" or "IT Assets Request" workflow seeded for
-- staging) that should never appear to normal users -- today every workflow (and every
-- ticket under it) is unconditionally visible to any tenant member, with no way to
-- restrict a specific workflow to the "admin" role only. This column is that switch.
--
-- Default false preserves current behavior for every existing workflow; an admin sets
-- it to true per-workflow via the admin-ui workflow settings page.
--
-- Rollback (undoes only what THIS migration added):
--   ALTER TABLE workflows DROP COLUMN admin_only;

ALTER TABLE workflows
  ADD COLUMN admin_only boolean NOT NULL DEFAULT false;
