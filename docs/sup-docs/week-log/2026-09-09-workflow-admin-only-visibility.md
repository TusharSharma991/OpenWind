# 2026-09-09 — workflow admin-only visibility

Two test workflows seeded on the deployment ("Leave Approval", "IT Assets Request") needed to be
hidden from every normal user — Workflows page, Records page, dashboard, and the third-party
API — visible only to the global `admin` role. No such visibility concept existed before this;
every workflow was unconditionally visible to every tenant member.

## Schema

`workflows.admin_only boolean not null default false` (migration `0094_workflows_admin_only.sql`).
Default preserves existing behavior for every current workflow.

## The choke point, and why it wasn't enough on its own

`packages/workflow-engine/src/workflow-crud.ts`'s `visibleTo(tenantId, caller)` predicate is the
one real choke point: `getWorkflow`/`listWorkflows`/`listWorkflowsSummary`/`listWorkflowSlugs`/
`updateWorkflow`/`deleteWorkflow` all route through it, and now exclude `admin_only=true` rows
unless `caller.isGlobalAdmin`. `getWorkflow` 404s (not a distinguishable 403) for a non-admin
caller hitting an admin-only workflow directly by id.

That covers third-party `GET /workflows`, ticket create/read (`tickets.ts`, `list-tickets.ts`),
and the admin-ui Workflows page (`workflows/list.ts`, `get.ts`) automatically — but several
routes query `entity_instances`/`workflows` directly, bypassing this choke point entirely, and
each needed its own explicit check:

- `entities/get.ts` (ticket detail) — `hasEntityAccess` treats `agent` as unrestricted; added an
  explicit `admin_only && !roles.includes("admin")` gate after the existing access check.
- `entities/list.ts` (Records page) — resolves the workflow for the requested `entityTypeId` and
  404s (`ENTITY_TYPE_NOT_FOUND`) for a non-global-admin before the existing privilege/scoping
  logic runs.
- `entities/list-children.ts` and `third-party/children.ts` (sub-ticket create) — neither called
  `getWorkflow` at all; added a lightweight `isWorkflowAdminOnly(db, tenantId, workflowId)` helper
  (workflow-crud.ts) for these and used it directly.
- `entities/my-tickets.ts` — purely "tickets I have a relationship to," no workflow-visibility
  check existed; added a `NOT EXISTS` subquery against `workflows.admin_only` to the base filter
  (single round-trip, not a separate lookup + `notInArray` — `notInArray` evaluates to `NULL`,
  not true, for a `NULL` workflowId, which would have silently excluded every workflow-less
  ticket).
- `dashboard/my-view.ts` (`fetchAdminWorkflows`), `dashboard/org-view.ts`,
  `dashboard/team-member-view.ts` (`resolveUserScopedEntityIds` in `entities/scoped-access.ts`,
  shared by all three dashboard views) — same `NOT EXISTS` pattern, gated by a new
  `isGlobalAdmin` option on `resolveUserScopedEntityIds` (defaults to excluding admin-only
  workflows; the three callers now pass `roles.includes("admin")`).

**Only the global `admin` role bypasses this — not `agent`.** Confirmed explicitly per the
request ("only admin user/s can see them"); several existing checks (`hasEntityReadAccess`,
`entities/list.ts`'s `isPrivileged`) treat `agent` as unrestricted for other purposes, so this
needed its own, separate role check rather than reusing those.

## Admin-ui toggle

Added an "Admin only" checkbox to the workflow settings page (`workflows/detail.tsx`), rendered
only for a global admin, wired to the existing workflow-update route
(`PATCH /workflows/:id { adminOnly: boolean }`). `updateWorkflow` rejects the field with
`WORKFLOW_ADMIN_LIST_FORBIDDEN` for a non-global-admin caller (even a per-workflow admin via
`createdBy`/`assignedTo`) — this flag is a platform-wide visibility switch, not a per-workflow
setting a workflow's own admins should be able to flip unilaterally.

## Verification

- `pnpm typecheck`, `pnpm lint`: clean across all 42 workspace packages
- `workflow-crud.test.ts`: 27 tests (8 new) — query-construction-level checks that the
  `admin_only` exclusion is applied/omitted correctly for non-admin/global-admin callers
- New isolation tests, real Postgres, RLS enforced: `workflow-admin-only-visibility.isolation.test.ts`
  (get/list/list-children), `my-tickets.isolation.test.ts` (added), `third-party-workflows-list.isolation.test.ts`
  (added), `third-party-subticket-create.isolation.test.ts` (added) — 91 tests total across the
  touched isolation files, all green
- Found and fixed two real regressions in existing mocked-DB unit tests while integrating this
  (`entities/my-tickets.test.ts`, `entities/children.test.ts`) — both were call-count/import-shape
  breaks from the new admin-only checks, not behavior changes; fixed by folding the check into a
  single query (`my-tickets.ts`) and adding an `importOriginal`-based partial mock
  (`children.test.ts`) rather than loosening either test
- 12 pre-existing, unrelated isolation-test failures (missing `installed_plugins`/plugin-system
  migration state, `tenants.status` drift on the local `platform_test` DB) confirmed via `git
stash` to fail identically without this change — not caused by, or fixed by, this work

## Not done in this change

- No data migration flips `adminOnly` on for the actual two seeded workflows on any deployment —
  that's a deliberate admin-ui action (the new toggle), not something this change does for you.
