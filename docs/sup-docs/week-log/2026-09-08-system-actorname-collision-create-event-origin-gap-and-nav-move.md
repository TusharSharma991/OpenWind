# 2026-09-08 — system-actorname collision, missing create-event origin tagging, and Workflows nav move

Continuation of the same day's `system-comment-origin-mislabel-and-origin-tag-collapse` fixes,
found via further local rebuild + live retest against `aw-backend`/`aw-worker`/`aw-frontend`.

## Bug: System Agent reply displayed as truncated "system…"

The previous fix (see the sibling entry above) simplified the actor label from `"System Agent"`
to plain `"system"` — but `actorId` is _also_ the literal sentinel `"system"`.
`list-workflow-events.ts`'s snapshot-name dedup guard discards `metadata.actorName` whenever it
exactly equals `actorId` (an anti-duplication measure for the normal case where a user's display
name happens to equal their id-derived label), so both being `"system"` tripped the guard and
fell back to `actorId.slice(0, 8) + "…"` = `"system…"`.

Fixed by capitalizing the display label to `"System"` (distinct string from the `actorId`
sentinel) in both `post-system-comment.ts` and `mention-resolution-worker.ts`.

## Bug: API-created tickets' own "create" history entry showed a meaningless raw UUID

`createEntity` (`packages/entity-engine/src/engine.ts`) and `createChildRelation`
(`packages/entity-engine/src/child-relations.ts`) both write `originMechanism`/
`originOidcClientId`/`originPerformerUserId` onto `entity_instances` when a third-party API
creates a ticket — but neither forwarded those same fields onto the `workflow_events` "create"
row they also insert in the same call. The record's own creation history entry therefore showed
an unresolvable application-actor UUID (e.g. `ad80aefd…`) with no app/person attribution, unlike
every other API-originated event (comments, remark-as-first-comment) on the same ticket.

Also caught and fixed before shipping: `engine.ts`'s new `triggeredBy` mapping initially wrote
`input.actorType` directly, but `workflow_events.triggered_by`'s canonical vocabulary is
`user|automation|api|system` — `"api_key"` (actorType's own vocabulary) is never a valid value.
Mapped `actorType === "api_key" ? "api" : ...`, matching `child-relations.ts`'s pre-existing
correct mapping for sub-ticket creation.

New isolation test coverage in both `third-party-ticket-create.isolation.test.ts` and
`third-party-subticket-create.isolation.test.ts` asserts the create event itself (not just the
entity row) carries `triggeredBy`/`originMechanism`/`originOidcClientId`/`originPerformerUserId`.

## UI: record history/timeline didn't render origin data even once the API carried it

`record-detail.tsx`'s `renderFeedEvent` (create/update/transition branches) never rendered
`OriginTag` at all — just `resolveActorName` on the application's synthetic actor id, which is
meaningless to show as a person name. Fixed by rendering the performer's real resolved name as
the bold text, with an `OriginTag` badge appended after it — matching the comment feed's existing
`author name` + separate badge layout.

While wiring this in, found a **duplicate tag bug**: a pre-existing separate sibling block (per
`docs/specs/third-party-api-origin-tagging.md` R5, unrelated to today's changes) was
unconditionally rendering a second `OriginTag` below every non-comment event. Removed it as
redundant, after first confirming the create/update/transition branches each render their own
inline `OriginTag` so no origin-tagging coverage was lost.

## UI: Workflows nav item moved into the admin-only section

Per explicit request: normal/agent users should only see Dashboard, Users, Records in the main
sidebar nav. Moved the `Workflows` entry out of the shared admin+agent `ADMIN_NAV` array into the
admin-only `SUPER_ADMIN_NAV_EXTRA` section (`apps/admin-ui/src/components/layout.tsx`) — agents no
longer see it; admins see it under the "Admin" section alongside Templates/Automations/etc. The
`/workflows` route itself is unaffected (still gated by its own `RequireAdmin`-equivalent guard in
`App.tsx`) — this is a nav-visibility change only, not an access-control change.

## Verification

- `pnpm typecheck` / `pnpm lint`: clean across all 42 workspace packages
- `third-party-ticket-create.isolation.test.ts` / `third-party-subticket-create.isolation.test.ts`:
  34 tests, green (new create-event origin-tagging assertions included)
- `mention-resolution-worker.test.ts`: 17 tests, green
- `origin-tag.test.tsx`, `record-detail.test.tsx`: green
- `layout.test.tsx`: 1 pre-existing, unrelated failure (a `vi.mock` on `authProvider.js` missing
  the `getRolesFromProfile` export) confirmed via `git stash` to fail identically without this
  change — not a regression
- `pnpm test` (worker): 4 pre-existing, unrelated isolation-test failures confirmed via the same
  `git stash` method (stale local DB schema — missing `installed_plugins` table, `tenants.status`
  enum drift) — not touched by, or caused by, this diff

## Note on server access

Local-only for this session per an explicit instruction earlier in the day ("dont access server
again at all"). Deployment to the production server was re-authorized afterward, scoped to the
existing `nexus-OW` working directory only, for exactly this batch of changes.
