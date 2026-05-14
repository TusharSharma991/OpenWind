## What does this PR do?

<!-- One paragraph. What changed and why. Link to the ticket. -->

Closes #

---

## Type of change

- [ ] `feat` — new feature
- [ ] `fix` — bug fix
- [ ] `perf` — performance improvement
- [ ] `refactor` — code restructuring (no behavior change)
- [ ] `test` — tests only
- [ ] `docs` — documentation only
- [ ] `chore` — build, deps, tooling
- [ ] `security` — security fix

---

## Checklist

### Required for all PRs

- [ ] Tests included — coverage does not drop
- [ ] TypeScript compiles with zero errors (`pnpm typecheck`)
- [ ] Lint passes (`pnpm lint`)
- [ ] Commit messages follow Conventional Commits

### Required if this PR touches `packages/db/` or any new tables

- [ ] All new tenant-scoped tables have `tenant_id UUID NOT NULL`
- [ ] All new tenant-scoped tables have `ENABLE ROW LEVEL SECURITY`
- [ ] Both read and write RLS policies are defined
- [ ] `tenant_id` index is present
- [ ] Tenant isolation tests added or updated (`tests/isolation/`)
- [ ] Down migration (rollback SQL) is present as a comment in the migration file

### Required if this PR touches `apps/api/` or adds new routes

- [ ] All inputs validated with Zod at the route boundary
- [ ] Authentication middleware applied (`requireAuth()`)
- [ ] Rate limiting configured for the endpoint
- [ ] E2E tests cover the new route
- [ ] Tenant isolation tests cover the new route

### Required if this PR makes a significant architectural decision

- [ ] ADR created or updated in `docs/decisions/`
- [ ] ADR reviewed by at least one other engineer

### Required if this PR changes a public API

- [ ] `CHANGELOG.md` entry added
- [ ] Backwards compatibility considered (breaking changes need migration path)

---

## How to test

<!-- Steps to verify this PR locally, beyond running the test suite. -->

1.
2.
3.

---

## Screenshots / recordings

<!-- If this touches UI, include before/after screenshots or a screen recording. -->

---

## Notes for reviewers

<!-- Anything the reviewer should pay particular attention to, or decisions made
     that are not captured in the ADRs. -->
