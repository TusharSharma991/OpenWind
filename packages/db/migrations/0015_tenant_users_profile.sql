-- Down migration (rollback):
-- ALTER TABLE "tenant_users" DROP COLUMN IF EXISTS "email";
-- ALTER TABLE "tenant_users" DROP COLUMN IF EXISTS "display_name";

-- Add profile columns to tenant_users so the platform can expose a user list
-- without calling the Zitadel Management API on every request.
-- Populated by the auth middleware upsert on every successful JWT login.
-- email and display_name are nullable because API-key auth paths don't have them.

ALTER TABLE "tenant_users"
  ADD COLUMN IF NOT EXISTS "email"        text,
  ADD COLUMN IF NOT EXISTS "display_name" text;
