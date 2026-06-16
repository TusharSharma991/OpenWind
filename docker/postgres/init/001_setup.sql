-- docker/postgres/init/001_setup.sql
-- Runs once on first container start.
-- Creates application users, databases, and enables required extensions.

-- ─── Zitadel database ────────────────────────────────────────────────────────
CREATE DATABASE zitadel;

-- ─── Application database users ───────────────────────────────────────────
-- app_user: normal application runtime — subject to RLS, no DDL
CREATE USER app_user WITH PASSWORD 'app_user_dev_password';

-- migration_user: runs schema migrations — BYPASSRLS, DDL allowed
-- NEVER used in application runtime
CREATE USER migration_user WITH PASSWORD 'migration_user_dev_password' CREATEROLE;

-- analytics_user: read-only with BYPASSRLS for Metabase / reporting
CREATE USER analytics_user WITH PASSWORD 'analytics_user_dev_password';

-- ─── Grant connect ────────────────────────────────────────────────────────
GRANT CONNECT ON DATABASE platform TO app_user;
GRANT CONNECT, CREATE ON DATABASE platform TO migration_user;
GRANT CONNECT ON DATABASE platform TO analytics_user;

-- ─── Extensions (run as superuser during init) ─────────────────────────────
\c platform

CREATE EXTENSION IF NOT EXISTS "pgcrypto";       -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";        -- trigram indexes for search
CREATE EXTENSION IF NOT EXISTS "btree_gin";      -- GIN indexes on scalar types
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements"; -- query performance

-- ─── Schema setup ─────────────────────────────────────────────────────────
-- migration_user owns the schema and can alter it
ALTER SCHEMA public OWNER TO migration_user;

-- app_user gets usage + DML
GRANT USAGE ON SCHEMA public TO app_user;
GRANT USAGE ON SCHEMA public TO analytics_user;

-- Future tables: app_user gets DML, analytics_user gets SELECT
ALTER DEFAULT PRIVILEGES FOR ROLE migration_user IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;

ALTER DEFAULT PRIVILEGES FOR ROLE migration_user IN SCHEMA public
  GRANT SELECT ON TABLES TO analytics_user;

ALTER DEFAULT PRIVILEGES FOR ROLE migration_user IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- ─── Row-Level Security: ensure app_user cannot bypass ───────────────────
-- migration_user can bypass RLS (needed for migrations and cross-tenant ops)
ALTER USER migration_user BYPASSRLS;
ALTER USER analytics_user BYPASSRLS;
-- app_user explicitly cannot bypass RLS (this is the default, but explicit)
-- ALTER USER app_user NOBYPASSRLS; -- this is the default

-- ─── Verification ─────────────────────────────────────────────────────────
SELECT
  rolname,
  rolsuper,
  rolbypassrls,
  rolcreaterole
FROM pg_roles
WHERE rolname IN ('platform', 'app_user', 'migration_user', 'analytics_user');
