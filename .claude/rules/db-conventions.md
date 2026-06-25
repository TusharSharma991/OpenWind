---
paths: ["packages/db/**", "tests/isolation/**", "**/*.sql", "**/migrations/**"]
---

# Database Conventions — OpenWind Platform

---

## Drizzle is the only query layer

No raw SQL in application code except:

1. Migration files in `packages/db/migrations/`
2. Explicitly performance-critical hot paths with a comment explaining why Drizzle was insufficient

Never instantiate a DB client. Always import from `@platform/db`.

**Tenant isolation uses two layers — both are required:**

1. **Explicit `WHERE tenant_id = ?` filters** in every engine query. These are the primary guard and must not be removed.
2. **RLS via `set_config('app.tenant_id', …)`** set by `withTenantContext`. This is the second line of defence.

`withTenantContext` sets the GUC but does not switch the DB role. If `DATABASE_URL` points at a superuser or table owner, RLS is bypassed and only the explicit filters protect you. Never remove explicit tenant filters on the assumption that RLS alone is sufficient. `withTenantAndUserContext` (used for saved views) sets both `app.tenant_id` and `app.user_id` and is the pattern to follow for user-scoped resources.

---

## Every tenant-scoped table requires

```sql
tenant_id UUID NOT NULL REFERENCES tenants(id)
-- RLS policy — see ADR-001
-- index on tenant_id
-- composite index for the primary query pattern
```

Missing any of these is a PR blocker.

---

## Migration files

Numbered SQL files only — never `drizzle push`:

```
packages/db/migrations/
  0001_initial_schema.sql
  0002_add_workflow_events.sql
```

Each migration file must include:

- A **down migration** as a comment block at the top
- `-- analytics: excluded (reason)` OR `-- analytics: included(col1,col2,...)` on every `CREATE TABLE`
- Runs in a transaction — partial migrations are a production incident

Migration PR checklist:

- [ ] `tenant_id NOT NULL` on all new tenant-scoped tables
- [ ] RLS policy for each new table
- [ ] Index on `tenant_id`
- [ ] Index on primary query pattern
- [ ] Down migration (rollback SQL) at the top as a comment
- [ ] Analytics annotation on every `CREATE TABLE`

---

## Isolation tests travel with every new table

Adding a new tenant-scoped table? Add isolation tests in `tests/isolation/` in the
same PR. The isolation suite attempts cross-tenant access via every public API surface.

Run: `pnpm test:isolation` (requires Docker/OrbStack stack).
