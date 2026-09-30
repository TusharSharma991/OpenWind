-- analytics: excluded (RLS policy fix only — no new table)
--
-- Same bug class as migration 0092 (api_keys), found in 3 worker jobs that
-- were failing every tick in production: connector-poll-scheduler,
-- attachment-cleanup, file-cleanup. All three run bare, cross-tenant sweep
-- queries against a table (connector_credentials, attachments, files) whose
-- tenant_read/tenant_write policy casts current_setting('app.tenant_id',
-- true) directly to ::uuid. current_setting(name, missing_ok=true) returns
-- NULL only the first time a custom GUC is read on a backend connection;
-- once any withTenantContext call has SET it on that same pooled connection,
-- later reads return '' (empty string, the GUC's reset value) instead of
-- NULL, and ''::uuid throws `invalid input syntax for type uuid: ""`
-- instead of the NULL comparison RLS expects. Worker jobs share a small
-- pooled set of connections across many withTenantContext-using jobs, so a
-- bare cross-tenant sweep on any connection previously used for a
-- tenant-scoped write reliably hits this.
--
-- Fix: nullif(current_setting(...), '') collapses the empty-string reset
-- value back to NULL before the ::uuid cast, matching "no tenant context
-- set" semantics RLS already expects and safely filters on. Same fix as
-- 0092, applied to the 3 other tables found to have bare cross-tenant
-- worker queries against them.
--
-- Rollback (undoes only what THIS migration added):
--   DROP POLICY tenant_read ON connector_credentials;
--   DROP POLICY tenant_write ON connector_credentials;
--   CREATE POLICY tenant_read ON connector_credentials
--     FOR SELECT
--     USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
--   CREATE POLICY tenant_write ON connector_credentials
--     FOR ALL
--     USING      (tenant_id = current_setting('app.tenant_id', true)::UUID)
--     WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID);
--
--   DROP POLICY "attachments_tenant_isolation" ON attachments;
--   CREATE POLICY "attachments_tenant_isolation"
--     ON attachments
--     USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
--     WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--
--   DROP POLICY "files_tenant_isolation" ON files;
--   CREATE POLICY "files_tenant_isolation"
--     ON files
--     USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
--     WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY tenant_read ON connector_credentials;
DROP POLICY tenant_write ON connector_credentials;

CREATE POLICY tenant_read ON connector_credentials
  FOR SELECT
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::UUID);

CREATE POLICY tenant_write ON connector_credentials
  FOR ALL
  USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::UUID)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::UUID);

DROP POLICY "attachments_tenant_isolation" ON attachments;

CREATE POLICY "attachments_tenant_isolation"
  ON attachments
  USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY "files_tenant_isolation" ON files;

CREATE POLICY "files_tenant_isolation"
  ON files
  USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
