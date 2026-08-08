# Implementation Plan: My Org View

**Spec:** docs/specs/my-org-view.md
**Generated:** 2026-08-08
**Status:** not started

---

## Phase 1 — AuthNexus data resolver

**Goal:** A single, well-tested function turns "orgId + userId + bearerToken" into a flat
list of subordinate ids, with bounded degrade-on-failure behavior — no route or UI depends
on it yet.
**Gate:** all unit tests pass (mocked AuthNexus responses only — no sandbox exists) → then
Phase 2

| task                                                                                                                                                                          | requirement    | status |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------ |
| T1: `getSubordinateIds(orgId, userId, bearerToken)` in `packages/auth/src/authnexus-management.ts` — calls `GET /connections?detail=ids`, returns `{ids, hasReports, status}` | R1, R6         | todo   |
| T2: Flatten `descendants.reports` (nested tree, any depth) into a flat `string[]` of `userId`s                                                                                | R6             | todo   |
| T3: Handle non-200 responses → `status: "unavailable"` immediately, no retry                                                                                                  | R3             | todo   |
| T4: Handle `dataIncomplete: true` → bounded retry within a ~20 min session budget, then permanent `status: "unavailable"`                                                     | R3, §V         | todo   |
| T5: Log (not surface) `wasCycleMember: true` on any resolved node                                                                                                             | §V             | todo   |
| T6: Short-TTL in-process cache keyed on `(orgId, userId)`, matching `_assignmentsCache`'s existing pattern                                                                    | R7             | todo   |
| T7: Unit tests — happy path, 0 reports, deep/nested tree, `dataIncomplete` (both resolves-in-time and times-out), `wasCycleMember`, non-200, network error                    | R1, R3, R6, §V | todo   |

---

## Phase 2 — API route

**Goal:** `GET /dashboard/org-view` exists, self-scoped only, reuses My View's existing
section-building logic, fully isolated from `/dashboard/my-view`'s failure surface.
**Gate:** integration + isolation tests pass + Phase 1 gate still green → then Phase 3

| task                                                                                                                                                                                    | requirement | status |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ |
| T8: New route file `apps/api/src/routes/dashboard/org-view.ts` — `requireAuth()` only, no role check                                                                                    | R1, R5      | todo   |
| T9: Target userId is always `c.get("auth").userId` — no query/body param accepts a userId ever                                                                                          | R5, §V      | todo   |
| T10: Call T1's `getSubordinateIds`, then `resolveUserScopedEntityIds(tenantId, [userId, ...subordinateIds])` unmodified from `scoped-access.ts`                                         | R2          | todo   |
| T11: Reuse `my-view.ts`'s section builders (`buildTicketsSection`/`buildDueDatesSection`/`buildSlaRiskSection`) via import, not copy-paste                                              | R2          | todo   |
| T12: Response includes `hasReports`/`unavailable` flags per §I's contract                                                                                                               | R1, R3      | todo   |
| T13: Register `GET /org-view` in `apps/api/src/routes/dashboard/index.ts`                                                                                                               | R4          | todo   |
| T14: Wrap the whole handler so any org-view failure never throws into / affects `/dashboard/my-view`'s process (separate route = already isolated, but confirm no shared mutable state) | R3, §V      | todo   |
| T15: Isolation tests — org-view respects tenant boundary same as my-view; cross-tenant subordinate ids (if any leaked from AuthNexus) never leak tickets across tenants                 | R2, §V      | todo   |
| T16: Integration tests — full route with mocked `getSubordinateIds`, confirm 200/unavailable/hasReports:false paths                                                                     | R1, R3, R5  | todo   |

---

## Phase 3 — Frontend

**Goal:** Managers see a "My Org View" toggle and page, built on My View's existing visual
conventions; non-managers never see it; My View's own page/route is untouched.
**Gate:** §R acceptance criteria met (manual + automated)

| task                                                                                                                                                                                                      | requirement | status |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ |
| T17: New page `apps/admin-ui/src/pages/dashboard-org.tsx` (or similar), fetches `/dashboard/org-view`, renders sections reusing My View's components/styles (filter tabs, SLA coloring, skeleton loaders) | R4          | todo   |
| T18: New route registration in `apps/admin-ui/src/App.tsx` (e.g. `/dashboard/org`)                                                                                                                        | R4          | todo   |
| T19: Toggle on `apps/admin-ui/src/pages/dashboard.tsx` — rendered only after confirming `hasReports: true` from a probe call; zero other changes to `dashboard.tsx`'s existing code paths                 | R1, R4, §V  | todo   |
| T20: "Unavailable" UI state (distinct from empty-state) for `unavailable: true`                                                                                                                           | R3          | todo   |
| T21: Frontend tests — toggle visibility (0 reports / has reports / unavailable), unavailable-state rendering, confirm My View's own tests still pass unmodified                                           | R1, R3, R4  | todo   |

---

## Kick-Off Prompt

Copy this into your Claude Code session to start implementation:

```
Read docs/specs/my-org-view.md and docs/specs/my-org-view-tasks.md.

Implement Phase 1 tasks only (T1-T7).

Rules:
- Do not begin Phase 2 until all Phase 1 tests pass
- After each task, run relevant tests and confirm pass before continuing
- If you hit a decision not covered by the spec, stop and ask — do not assume
- If a test fails, run: /spec amend §B to log it before fixing
- If the same bug class could recur, run: /spec amend §V to make it an invariant
- Never accept a target userId as a route/function param that could come from client input — always derive from the verified JWT sub (R5, non-negotiable per spec §V)
- No AuthNexus-specific types leak into packages/* outside authnexus-management.ts, or into apps/api/src/routes/entities/scoped-access.ts
```
