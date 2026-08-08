# My Org View

> Manager/team ticket-workload rollup, AuthNexus-fork-only — extends My View's scoping to a user's org subtree.

status: draft
created: 2026-08-08
updated: 2026-08-08

---

## §G Goal

A user with direct/indirect reports (per AuthNexus org-hierarchy data) can see an
aggregate view of their team's tickets/SLA-risk/due-dates, on top of (not instead of)
their own My View. AuthNexus-fork-only — never ships to core (`tushar`/TinyPhi), never
depends on role (admin/agent), only on the fact of having reports.

---

## §C Constraints

| constraint   | value                                                                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| stack        | Hono API (`apps/api`, this fork only), React admin-ui, AuthNexus org-connections API                                                    |
| auth         | Forward caller's own bearer token to AuthNexus (not a fresh M2M mint); target userId always server-derived from JWT `sub`               |
| data source  | `GET /api/admin/orgs/{org_id}/users/{user_id}/connections?detail=ids` (AuthNexus, unversioned, no SLA)                                  |
| out of scope | Core/`packages/*` (no AuthNexus types leak upstream); matrix/multi-org reporting; real-time push; viewing others' org view; role-gating |

---

## §I Interfaces

**AuthNexus (external, not ours):**
`GET /api/admin/orgs/{org_id}/users/{user_id}/connections?detail=ids`
→ `{ dataIncomplete, user, ancestors, descendants: { directReportsCount, totalReportsCount, reports } }`
`reports` = nested tree, `?detail=ids` shrinks each node to `{username, userId}`.

**New, this fork only:**

```ts
// packages/auth/src/authnexus-management.ts
function getSubordinateIds(
  orgId: string,
  userId: string,
  bearerToken: string,
): Promise<{
  ids: string[]; // flattened descendants.reports, all levels
  hasReports: boolean; // directReportsCount > 0
  status: "ok" | "unavailable"; // unavailable = non-200, or dataIncomplete past retry budget
}>;
```

```
GET /dashboard/org-view   (apps/api/src/routes/dashboard/org-view.ts)
  auth: requireAuth() only — no role check
  target userId: always c.get("auth").userId (JWT sub) — never a query/body param
  200 → same section shapes as GET /dashboard/my-view (tickets/dueDates/slaRisk/workflows)
  200 { unavailable: true } → org data temporarily/permanently unreachable, sections empty
  200 { hasReports: false } → caller has no reports; frontend hides the toggle
```

Frontend: new route (e.g. `/dashboard/org`), toggle rendered on `/dashboard` only after
confirming `hasReports: true`.

---

## §R Requirements

R1: Org view is gated only on having reports, never on platform role.
✓ User with `directReportsCount === 0`, any role including admin → toggle hidden, route unreachable
✓ Non-admin user with `directReportsCount > 0` → toggle shown, route works

R2: Org view reuses `resolveUserScopedEntityIds`/`buildUserScopeFilter` unmodified.
✓ `org-view.ts` imports the existing function from `scoped-access.ts` — no new predicate logic added there
✓ Scoped ticket set = union of `[self, ...flattened subordinate ids]`

R3: Org view degrades independently of My View — never blocks or breaks it.
✓ Non-200 from AuthNexus `/connections` → immediate `unavailable` state, no retry loop, no exception surfaced to caller
✓ `dataIncomplete: true` → bounded retry within one session (~20 min budget), then permanent `unavailable` fallback for that session — never infinite retry, since AuthNexus cannot distinguish "will heal" from "permanently excluded" in the payload
✓ `GET /dashboard/my-view` succeeds and is unaffected regardless of org-view/AuthNexus state (separate route, separate code path, no shared failure surface)

R4: Toggle/switcher UI between My View and My Org View — not a merged page.
✓ `apps/admin-ui/src/pages/dashboard.tsx` (My View) has zero new AuthNexus-aware code paths
✓ Org view is a distinct route/component

R5: Self-only scope enforcement (AuthNexus enforces none beyond org boundary — any org member's token can query anyone's `/connections`, so this fork must restrict it).
✓ `org-view.ts` never accepts a client-supplied target `userId` — always `c.get("auth").userId`
✓ No parameter, route, or code path exists to fetch another user's org connections

R6: Nested `descendants.reports` tree is flattened before scoping.
✓ `getSubordinateIds` returns a flat `string[]` regardless of AuthNexus's nested response shape
✓ Uses `?detail=ids` to minimize payload (only need `userId`, not full profiles)

R7: Short-TTL server-side caching, tolerant of AuthNexus's own staleness.
✓ Cache TTL on the order of minutes, matching `authnexus-management.ts`'s existing `_assignmentsCache` pattern
✓ No dependency on push/webhook invalidation (confirmed not to exist)

---

## §V Invariants

- Org-view route NEVER accepts a target `userId` from client input — always the
  server-verified JWT `sub`. (R5 — AuthNexus provides no per-endpoint authorization
  beyond org boundary; this fork is the only enforcement layer.)
- Org-view failures never block, delay, or crash My View's own request path — fully
  isolated route + try/catch, same pattern `my-view.ts` already uses per-section.
- No AuthNexus-specific types/interfaces added to `packages/*` (outside
  `packages/auth/src/authnexus-management.ts`) or to
  `apps/api/src/routes/entities/scoped-access.ts` — core stays AuthNexus-agnostic.
- `dataIncomplete` retries are bounded (~20 min) then permanently fall back for that
  session — never an unbounded retry loop.
- `wasCycleMember: true` on a resolved subtree is logged server-side only (signals a
  data-quality problem in AuthNexus's source HR data) — never surfaced as a user-facing
  error, since the tree is still usable, just structurally wrong for the affected nodes.

---

## §T Tasks

Full breakdown: `docs/specs/my-org-view-tasks.md` (21 tasks, 3 phases). Summary:

| id      | task                                                                                                    | phase | status | depends |
| ------- | ------------------------------------------------------------------------------------------------------- | ----- | ------ | ------- |
| T1-T7   | `getSubordinateIds()` resolver (call, flatten, degrade, cache) + unit tests                             | 1     | todo   | —       |
| T8-T16  | `GET /dashboard/org-view` route (self-scoped, reuses my-view.ts builders) + integration/isolation tests | 2     | todo   | T1-T7   |
| T17-T21 | `/dashboard/org` page + toggle on `/dashboard` + frontend tests                                         | 3     | todo   | T8-T16  |

phase gate: all unit + integration tests pass before advancing to next phase

---

## §B Bugs / Backprop Log

| id  | what failed | root cause | promoted to §V? |
| --- | ----------- | ---------- | --------------- |
| —   | —           | —          | —               |

---

_spec is source of truth — update as decisions are made_
