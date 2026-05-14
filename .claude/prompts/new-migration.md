# Prompt: Write a database migration

## Checklist for every migration

- [ ] tenant_id UUID NOT NULL on all new tenant-scoped tables
- [ ] ENABLE ROW LEVEL SECURITY on each new table
- [ ] Read and write RLS policies defined
- [ ] Index on tenant_id
- [ ] Composite index for primary query pattern
- [ ] Down migration as comment block at top of file

## Template prompt

"Write a migration to [DESCRIPTION]. The table is tenant-scoped.
Include RLS policies, indexes, and a rollback block. File: packages/db/migrations/[NUMBER]\_[name].sql"
