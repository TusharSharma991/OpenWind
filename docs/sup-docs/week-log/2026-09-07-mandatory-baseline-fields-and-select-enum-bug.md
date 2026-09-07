## 2026-09-07 — Mandatory baseline fields (title/assignedTo/dueDate/remark) + select/enum validation bug

**Session type:** Feature + bug fix, found via manual testing against a local AuthNexus/NexusOW
setup through OWTesterUI
**Branch:** `new`

### Context

Continuing manual testing of the third-party API after the 2026-09-04 origin-tagging RLS fixes.
Creating a ticket on Support Ticket Lifecycle with `priority`/`category` omitted unexpectedly
succeeded (`201`) despite both being marked `is_required: true`. Investigating that surfaced a
second, separate, much bigger gap: `assignedTo`/`dueDate`/`remark` — a platform-wide convention
that every ticket should carry these regardless of workflow — were never actually enforced
server-side anywhere, on any workflow, for any caller.

### Bug 1 — `select` field type silently bypassed validation entirely

`modules/helpdesk/seed/001_entity_types.sql` seeds `priority`/`category` with
`field_type = 'select'` (and a plain `string[]` `options` shape) — this is the module's real,
shipped seed data, not a one-off local mistake. `packages/entity-engine/src/field-types.ts`'s
canonical `FieldType` list only recognized `'enum'`, and `schema-builder.ts`'s `buildFieldSchema`
switch had no `'select'` case, falling through to `default: return z.unknown()` — which accepts
anything, including a completely missing value, silently defeating both type validation and
`is_required` for any field stored as `'select'`.

Audited all 6 real local workflows (Leave Approval, Support Ticket Lifecycle, Sales & Tender
Opportunity, Order & Award Fulfillment, Payment Follow-up, NSI Amendment) directly against the
database — only Support Ticket Lifecycle's `priority`/`category` were affected; every other
workflow's required fields are plain `text`/`date`/`enum` types with correctly-shaped options.

**Fix:** added `'select'` to `FIELD_TYPES` as a recognized alias for `'enum'`, and a shared
`extractOptionValues()` helper in `schema-builder.ts` that accepts both the plain-string and
`{value,label}` option shapes, so existing seeded data in either shape now validates correctly —
zero data migration needed, purely a code fix.

### Bug 2 — assignedTo/dueDate/remark were never actually required, anywhere

Investigating the workflow settings UI (which shows Due Date/Assign To/Remark as "Required: Yes"
for every workflow) revealed that label is hardcoded display only — not read from any real
per-workflow setting (`apps/admin-ui/src/pages/workflows/detail.tsx`'s own `SYSTEM_DETAIL_FIELDS`
comment says as much: "listed for visibility only"). The admin-ui's create form
(`record-create.tsx`) does block submission client-side if these are empty, but the actual server
routes left all three optional (or, for `dueDate`/`remark` on the third-party API, didn't even
accept them as input at all) — so a direct API call (or the third-party API generally) could
create a ticket missing all three, and OpenWind's own admin-ui form was the _only_ thing
preventing it.

**Decision:** made `title` (already required everywhere, no change needed) + `assignedTo` +
`dueDate` + `remark` a genuine platform-wide invariant — required on every ticket create, on
every workflow, no per-workflow exceptions, enforced server-side on all 3 create routes:

- `apps/api/src/routes/entities/create.ts` (admin-ui) — `assignedTo`/`dueDate`/`remark` changed
  from optional to required in `CreateEntitySchema`.
- `apps/api/src/routes/third-party/tickets.ts` — added `dueDate`/`remark` as new required
  fields (previously not even accepted), `assignedTo` changed from optional to required.
- `apps/api/src/routes/third-party/children.ts` (sub-tickets) — same three fields added/required.
  Also required a real engine-level fix: `createChildRelation`/`CreateChildRelationInput`
  (`packages/entity-engine`) had no `remark` support at all — sub-tickets could never persist a
  remark regardless of caller. Added it, mirroring `createEntity`'s existing handling.

**⚠️ Breaking change to the documented third-party API contract** — updated
`third-party-api-reference.md` (§5.2, §5.5) with explicit breaking-change callouts, corrected
request/response examples, and a footer note. Any existing partner integration not sending all
three fields will 400 immediately after this ships.

### Test fallout and fixes

The schema tightening broke 6 existing isolation/unit test files whose fixtures predated the new
requirement (`create.test.ts`, `third-party-ticket-create`, `third-party-subticket-create`,
`entity-create-handoff-origin-tagging`, `third-party-attachments-reference-download`,
`third-party-phase-f-access-logs`, `third-party-workflow-fields`). Fixed each by adding valid
`assignedTo`/`dueDate`/`remark` values to their request bodies — not by weakening any assertions.
One of these (`entity-create-handoff-origin-tagging`) needed a new mock for
`authnexus-management.js`'s `listUserIdsWithRole` (an external AuthNexus API call, not the
database — mocking it follows testing-conventions.md's service-boundary-mocking rule) since
`assignedTo` becoming mandatory now always triggers the real-tenant-member check that route
already had, which isolation tests have no way to satisfy against the real AuthNexus API.

Added new Prove-It regression tests (fail on pre-fix code, pass on fix) for: the `select`/`enum`
bug (`schema-builder.test.ts`, 3 new tests), and the mandatory-baseline-fields requirement itself
across all 3 create routes (`create.test.ts` +3, `third-party-ticket-create` +4,
`third-party-subticket-create` +2) — confirmed by reverting the source changes and re-running,
all 10 new tests fail against the old code.

### Verification

- `pnpm --filter @platform/entity-engine typecheck/lint`: clean; full suite 227/227
- `pnpm --filter @platform/api typecheck/lint`: clean; full unit suite 694/694
- Full isolation suite: all 6 previously-broken files now pass; remaining failures are the same
  pre-existing flaky set already documented in the 2026-09-04 entries (confirmed unrelated —
  different files fail on repeated runs, none touch `api_keys`/entity creation)
- Live end-to-end via OWTesterUI against local AuthNexus/NexusOW: ticket-create and sub-ticket-
  create both correctly `400` when `assignedTo`/`dueDate`/`remark` are missing and `201` with them
  present; confirmed `remark` now actually persists on a sub-ticket (previously impossible at the
  engine level for any caller)

### Follow-up (same day) — discoverability gap in GET /workflows/:id/fields

After the above shipped, testing OWTesterUI's own dynamic create-ticket screen (which builds its
form purely from `GET /workflows/:id/fields`, exactly the pattern §5.1a/§6.1 of
`third-party-api-reference.md` documents) surfaced a real gap: that endpoint only ever returns
`entity_fields` rows (via `listEntityFields`), and `assignedTo`/`dueDate`/`remark` aren't
`entity_fields` rows at all — they're fixed columns on `entity_instances`. So an integration
following the documented discovery pattern had no way to learn these three now-mandatory fields
exist, and would 400 with no explanation.

Fixed by adding a `baselineFields` array to the response — deliberately separate from `fields`
since these are sibling top-level `POST /tickets` body keys, never nested inside the `fields`
object a caller submits. Updated `third-party-api-reference.md` (§5.1a) and OWTesterUI's
`app.js` (its guided create-ticket screen now renders and correctly submits `baselineFields` at
the top level, not inside `fields`).

Verification: `pnpm --filter @platform/api typecheck/lint` clean; new isolation test
(`includes baselineFields describing the mandatory assignedTo/dueDate/remark top-level params`)
confirmed failing without the fix, passing with it; live-verified via OWTesterUI's browser UI.
