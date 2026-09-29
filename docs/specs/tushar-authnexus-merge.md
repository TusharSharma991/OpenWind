# Tushar → nexus-OW merge: AuthNexus adaptation

> Merge 99 commits (27 migrations, `0085`-`0111`) from `tushar` (Zitadel-based) into `nexus-OW`
> (branch `new`, AuthNexus-based) with zero Zitadel-specific code remaining, for whoever
> maintains `nexus-OW`.

status: review
created: 2026-09-28
updated: 2026-09-28

---

## §G Goal

`tushar`'s 99-commit feature set (observability/ADR-015, on-call routing/ADR-016, temporal
scheduler/ADR-017, origin tagging, generalized user-ref resolver) lands on `new`, fully
functional against AuthNexus. No file that imports Zitadel-specific auth code (claim names,
Zitadel token-exchange wire format, `zitadel-management.ts`) ships in the merged tree, except
the one pre-existing, deliberate exception (`notification-outbound-auth.ts`'s native-Zitadel
token-endpoint call, required by ownovu's gateway, already AuthNexus-wired otherwise).

## §C Constraints

| constraint   | value                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| stack        | existing (Hono/Drizzle/TS, per CLAUDE.md) — no new deps for this work                                                                                                                                                                                                                                                                                                                                                                                     |
| auth         | AuthNexus only. `packages/auth/src/authnexus-management.ts` is the sole org-management client; `zitadel-management.ts` must never land in `new`                                                                                                                                                                                                                                                                                                           |
| perf         | org-member/role lookups now hit ~12 call sites per-request; must retain `authnexus-management.ts`'s existing 5-min cache + single-flight dedup coverage, no regression                                                                                                                                                                                                                                                                                    |
| out of scope | git merge/rebase execution mechanics; `notification-outbound-auth.ts` (already AuthNexus-native); new AuthNexus backend capabilities (spec only covers nexus-OW's consumption of what AuthNexus already exposes); ADR-015 observability, origin tagging, labels, temporal scheduler beyond conflict resolution (feature logic pulled in as-is — confirmed zero identity coupling)                                                                         |
| rollback     | T1 (the merge) is the one step with a defined bail-out: if conflict resolution becomes unsafe to reason about mid-merge, abort via `git merge --abort` before any commit lands, re-scope in this spec's §T, and retry — never force through a conflict resolution under time pressure. Once T1's merge commit lands, rollback is a revert, not an abort. **Already exercised twice** (§B B3, B4) before any commit landed — see revised scope below.      |
| ci.yml       | `.github/workflows/ci.yml` has a real merge conflict. Per `agent-behaviour.md`'s "Never do autonomously: Modify any `.github/workflows/` file," this conflict is resolved by the human, not this agent, under any circumstance — no bypass env excuses this one. T1 is split into T1a (agent resolves every other conflict, leaves `ci.yml` conflicted/unstaged) and T1b (human resolves `ci.yml`, agent completes the merge commit once told it's done). |

## §I Interfaces

`authnexus-management.ts` exports used by the 12 redirected call sites:

| function                | signature                                                | status                                                                                                                                |
| ----------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `listOrgUsers`          | `(orgId, bearerToken?) => Promise<OrgUser[]>`            | exists, confirm `OrgUser` has `userId`/`loginName`/`email`/`displayName`                                                              |
| `listUserRolesByUserId` | `(orgId, bearerToken?) => Promise<Map<string,string[]>>` | exists                                                                                                                                |
| `listUserIdsWithRole`   | `(orgId, roleKey, bearerToken?) => Promise<Set<string>>` | exists, unused by any redirected call site — keep for parity only                                                                     |
| `getUserById`           | `(userId, bearerToken?) => Promise<OrgUser\|null>`       | exists                                                                                                                                |
| `listProjectRoles`      | `(orgId, bearerToken?) => Promise<string[]>`             | exists, but `tushar`'s `platform/roles.ts` calls a no-arg version — needs orgId threaded through at the call site, not a new function |
| `deleteUser`            | —                                                        | **gap** — no equivalent exists. See R6.                                                                                               |

## §R Requirements

R0: The merge's non-auth conflicts (88 files total, confirmed via `git merge --no-commit --no-ff`
dry-run, see §B B3/B4) are resolved without regressing either tree's independent feature work —
`new`'s own commits since `4c2d1324` (admin-only workflow visibility, mention-resolution fixes,
origin gap fixes — see git log) are not silently discarded in favor of `tushar`'s version, and
vice versa. Spot-checked: `login.tsx`/`callback.tsx` conflicts are ordinary divergent-development
conflicts, not Zitadel-coupling (both already reference AuthNexus correctly) — same is assumed
true for the rest of admin-ui/isolation-tests/infra-config conflicts unless proven otherwise
during resolution.
✓ Every non-auth conflict resolution documented (which side won, or how both were merged) in the
merge commit message or a follow-up note, so a reviewer can audit the choice later.
✓ `pnpm test` + `pnpm test:isolation` pass after resolution — isolation-test add/add conflicts
(13 files, mostly `third-party-*`) in particular must not silently drop either branch's RLS
coverage.
✓ `.github/workflows/ci.yml` conflict is resolved by the human (per §C's `ci.yml` row), not this
agent, under any circumstance.

R1: Every real `zitadel-management.ts` call site in `tushar` is redirected to
`authnexus-management.ts` during merge, none reintroduce a `zitadel-management.ts` import.
✓ Re-grep `origin/tushar`'s tip at merge time (`git grep -ln "zitadel-management" origin/tushar`
plus a manual `@platform/auth`-import check, same method used to correct the original 8→12
list) and confirm the call-site count is still exactly these 12 — if a 13th site appears,
R1 is not satisfied until it's added to this list and redirected too:
`ensure-user-refs.ts`, `resolve-org-member.ts`, `resolve-origin-display.ts`,
`admin/members.ts`, `admin/on-call-schedules.ts`, `entities/add-comment.ts`,
`entities/create.ts`, `entities/list-workflow-events.ts`, `workflows/update.ts`,
`platform/users.ts`, `platform/roles.ts`, `mention-resolution-worker.ts`.
✓ Post-merge, all files in the confirmed list import only from `@platform/auth` /
`authnexus-management.ts`.
✓ `git grep -l "zitadel-management" apps/ packages/` (run against the merged `new` tree, not
`tushar`) returns zero hits, excluding the documented `notification-outbound-auth.ts` comment
reference. This is the exact command T11 must run — do not substitute a looser check.

R2: `platform/roles.ts` resolves project roles via AuthNexus, scoped to the request's own org
(matches T5 1:1 — this R exists specifically so T5 isn't the only place the requirement lives).
✓ Calls `listProjectRoles(orgId)` with the request's `AuthContext.orgId`, not a no-arg call.

R3: On-call roster eligibility filtering defaults to the same role-key set as `tushar`
(`["agent","admin","user"]`), pending T6's confirmation of nexus-OW's AuthNexus org composition.
✓ `admin/members.ts` / `admin/on-call-schedules.ts` filter `listUserRolesByUserId` results
against exactly `["agent","admin","user"]` as the implemented default.
✓ A code comment records this as a per-deployment decision (mirrors `tushar`'s commit
`4e440ecd` precedent), not a platform invariant — and explicitly notes it is unconfirmed
against nexus-OW's actual AuthNexus org membership (T6 still open).
✓ If T6 later confirms nexus-OW's org does mix in customer/external accounts under the
`"user"`-equivalent role, this R's accepted value flips to `["agent","admin"]` and the code
comment/filter are updated — tracked as a new §B entry if it happens post-implementation.

R4: `validateScheduleRefs`'s `tenant_users` self-heal fallback (from `tushar` commit
`4e440ecd`) works against AuthNexus.
✓ On a `tenant_users` miss for a picked on-call user id, falls back to
`listOrgUsers`/`listUserRolesByUserId` and upserts a `tenant_users` row on match.

R5: The generalized user-ref resolver (`ensure-user-refs.ts`) works against AuthNexus with the
same best-effort semantics `tushar` has (top-up only, never itself rejects).
✓ Missing-from-`tenant_users`-but-found-in-`listOrgUsers` → upserts `tenant_users` row.
✓ Missing from both → no insert, no error; downstream `entity-engine.validateUserRefs()`
still performs the actual rejection.
✓ A failed `listOrgUsers` call (network/auth error) does not crash the request — same
fail-to-`[]` shape as the org-lookup functions already have.

R6: GDPR erasure (`platform/users.ts`, ADR-015) produces some real, verifiable AuthNexus-side
effect on account erasure — never a silent no-op that only purges platform-side data.
**This R is intentionally not fully testable yet — resolving it requires the human decision in
T8 (does AuthNexus expose a deactivate/disable admin call?) before an acceptance criterion can
be written against a concrete function name.** Until T8 resolves:
✓ (interim) Erasure route logs and surfaces a distinct, non-2xx-masking signal if no
AuthNexus-side action was taken, so this gap is visible in monitoring rather than silently
looking like successful erasure.
✓ (post-T8, if AuthNexus has a deactivate/disable call) Erasure route calls it, using the
confirmed function name from T8, alongside the existing platform-side data purge — spec
updated with the concrete name once known, and this criterion replaces the interim one above.
✓ (post-T8, if AuthNexus has no such call) Escalated per BLOCKERS.md — R6 cannot be closed by
autonomous implementation; a human decides the accepted behavior (e.g. accept the gap, request
an AuthNexus API addition, or redefine "erasure" for this platform).

R7: All 27 new migrations (`0085`-`0111`) run unmodified.
✓ `pnpm db:migrate` succeeds against a fresh `new`-branch database with no manual edits to any
migration file.

R8: On-call auto-assign and severity notifications fire on a fresh tenant without manual
intervention.
✓ Fresh tenant with `helpdesk` module installed has the `resolve_oncall` /
`dispatch_severity_notification` `automation_rules` rows from
`modules/helpdesk/seed/003_automation_rules.sql` (module seed, no manual insert needed).
✓ A tenant that predates this seed file has the same 4 rows inserted by hand (one-time,
per-tenant operational task, not a migration).

R9: Legacy entity types (created before this merge) have `title`/`team_id` entity_fields.
✓ The detection query (see §T) returns zero rows post-remediation for any entity type actually
in active use on `new`.

R10: Org-member/role lookups retain existing caching after the merge adds ~12 call sites onto
`authnexus-management.ts` — no new per-request AuthNexus API calls beyond what caching already
allows for.
✓ `listOrgUsers`/`listUserRolesByUserId`/`getUserById` calls from all 12 redirected sites hit
`authnexus-management.ts`'s existing 5-min TTL cache and single-flight in-flight-Promise dedup
— verified by a test that fires N concurrent calls for the same orgId/userId and asserts
exactly one underlying `fetch` to AuthNexus.
✓ No redirected call site bypasses the cache (e.g. by calling a lower-level fetch directly).

## §V Invariants

- No file under `apps/` or `packages/` imports `zitadel-management.ts` or references a
  `urn:zitadel:iam:...` claim name, except `notification-outbound-auth.ts`'s documented,
  deliberate exception (native-Zitadel token endpoint required by ownovu's gateway).
- Every org-member/role lookup goes through `authnexus-management.ts` — no second,
  independent AuthNexus/Zitadel client is ever introduced for the same purpose.
- `ensure-user-refs.ts` (and any function like it) never turns an upstream AuthNexus API
  failure into a definitive "user does not exist" signal without it being traceable as a
  distinct failure mode: the `listOrgUsers`/`getUserById` call's own `catch` block logs at
  `error` level with `{ tenantId, orgId, error: err.code }` (per code-style.md's logging
  convention) before falling back to `[]`/`null`, so an incident investigator can grep the
  logs and distinguish "AuthNexus call failed" from "user genuinely not an org member."
- Before merging any long-diverged branch into `new`, the actual conflict surface is surveyed
  (`git merge --no-commit --no-ff` dry-run, or `git diff --stat <merge-base>...<branch>` against
  `new`'s own divergent history) and the spec's scope_paths updated to match reality — never
  scoped solely from a handoff doc's framing of "what changed," since two branches can each
  independently touch the same shared files for unrelated reasons after a sync point (§B B3).

## §T Tasks

Full phase-gated plan: `docs/specs/tushar-authnexus-merge-tasks.md`.

| id  | task                                                                                                                                                                                                                           | phase | status      | depends      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ----------- | ------------ |
| T1a | Merge `tushar` into `new` (`--no-commit --no-ff`); resolve all conflicts except `ci.yml` — auth-layer per R1-R6, non-auth per R0 (favor neither tree blindly, check each); leave `ci.yml` conflicted and the merge uncommitted | 1     | todo        | —            |
| T1b | **Human resolves `.github/workflows/ci.yml`** (off-limits to this agent, no exceptions); agent stages it and completes the merge commit once told it's resolved                                                                | 1     | todo        | T1a          |
| T2  | Run migrations `0085`-`0111`                                                                                                                                                                                                   | 1     | todo        | T1b          |
| T3  | Re-grep `origin/tushar` tip to confirm the 12-site list is exhaustive; redirect all confirmed sites to `authnexus-management.ts`                                                                                               | 1     | todo        | T1b          |
| T4  | Delete/never-merge `zitadel-management.ts` and its `apps/api` re-export shim                                                                                                                                                   | 1     | todo        | T3           |
| T5  | Thread `orgId` into `platform/roles.ts`'s `listProjectRoles` call (implements R2)                                                                                                                                              | 2     | todo        | T3           |
| T6  | Confirm on-call role-key list `["agent","admin","user"]` is safe for nexus-OW's AuthNexus org — resolves R3's open condition                                                                                                   | 2     | todo        | T3           |
| T7  | Wire `validateScheduleRefs` tenant_users self-heal fallback                                                                                                                                                                    | 2     | todo        | T3           |
| T8  | **BLOCKED — human decision required, not autonomous:** confirm whether AuthNexus exposes a user deactivate/disable admin call. Write to `BLOCKERS.md` per `.claude/rules/agent-behaviour.md` rather than guessing              | 2     | **blocked** | T3           |
| T9  | Verify `ensure-user-refs.ts` best-effort semantics against AuthNexus; add distinct-failure-mode log line (§V)                                                                                                                  | 2     | todo        | T3           |
| T10 | Caching-parity test: N concurrent lookups for the same key → exactly one underlying `fetch`                                                                                                                                    | 2     | todo        | T3           |
| T11 | Run entity-fields detection query; backfill `title`/`team_id` for any legacy entity type found                                                                                                                                 | 2     | todo        | T2           |
| T12 | Confirm/insert `automation_rules` rows for any pre-existing tenant (module seed covers fresh tenants automatically)                                                                                                            | 2     | todo        | T2           |
| T13 | Full verification: typecheck, lint, test, test:isolation; run R1's exact `git grep -l "zitadel-management" apps/ packages/` command against merged `new` and confirm zero hits (excluding the documented exception)            | 3     | todo        | T1-T7,T9-T12 |
| T14 | `/security-review` — auth-layer changes, per this repo's security.md mandate                                                                                                                                                   | 3     | todo        | T13          |

phase gate: all unit + integration tests pass before advancing to next phase. T8 is exempt from
blocking T13/T14 (auth/migration/feature work can verify and ship independently of the GDPR
deactivation decision), but the spec is not fully "implemented" until T8 closes.

## §B Bugs / Backprop Log

| id  | what failed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | root cause                                                                                                                                                                                                                                                                                                                                                                     | promoted to §V?                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Original handoff doc (`zitaToOw.md`) listed only 8 zitadel-management call sites                                                                                                                                                                                                                                                                                                                                                                                                                  | grep only matched the literal string `zitadel-management`, missing files importing via `@platform/auth`'s package export (`admin/on-call-schedules.ts`, `mention-resolution-worker.ts`) — 12 real call sites confirmed by manual cross-check                                                                                                                                   | no — one-time doc-accuracy issue, not a recurring code pattern                                                                                                                                                                                                                                                                                            |
| B2  | Spec's §I originally implied `listUserIdsWithRole` was a needed capability to port                                                                                                                                                                                                                                                                                                                                                                                                                | `tushar` defines `listUserIdsWithRole` in `zitadel-management.ts` but no real call site actually calls it — every caller uses `listUserRolesByUserId` and filters client-side instead                                                                                                                                                                                          | no — doesn't recur, but kept `listUserIdsWithRole` in §I as "parity only, unused" so a future implementer doesn't spend effort wiring it up as if it were load-bearing                                                                                                                                                                                    |
| B7  | Two more unconflicted test files (`admin/members.test.ts`, `platform/users.test.ts`) still mocked `zitadel-management.js` / asserted a `bearerToken` arg `listMergedOrgUsersByRole`'s actual (already-merged, unconflicted) implementation never passes                                                                                                                                                                                                                                           | Same root cause as B4/B6 — pre-existing test/implementation drift in files that never conflicted during the merge, only surfaced by actually running the suite                                                                                                                                                                                                                 | no — same recurring pattern as B4, already captured by that invariant                                                                                                                                                                                                                                                                                     |
| B8  | `apps/api/src/routes/api-keys/create.test.ts` had a genuine duplicate `const mockAssertExternalIssuerEgressAllowed` declaration (once via `vi.hoisted`, once as a plain `const`) causing a hard esbuild SyntaxError, only caught by actually running the suite (not by typecheck)                                                                                                                                                                                                                 | The plain `const` was dead leftover content that happened to land outside any conflict marker during the merge — same class of issue as the `layout.tsx`/`login.tsx` duplicate-block bugs (§B, no id) found earlier, but this time a hoisting-required duplicate rather than a JSX block                                                                                       | **yes → reinforces the existing §V invariant**: `git grep -c` for duplicate top-level `const`/`function` declarations is not sufficient on its own; only a full test-suite run (not just typecheck) reliably catches these, since esbuild's transform step — not tsc — is what surfaces a duplicate `const` when one copy is inside a `vi.hoisted()` call |
| B6  | `pnpm vitest run` (full 48-file admin-ui suite) intermittently fails 1-2 test files with a `getRolesFromProfile` mock/DOM-timeout error, different file each run (workflow-records.test.tsx once, workflow-records-severity-tag-filter.test.tsx another time) — but the same files pass reliably every time when run in isolation or in a small group together                                                                                                                                    | Worker-pool resource contention on this machine under the full 48-file suite (environment setup alone took 400s+ in one run) — not a deterministic bug introduced by the merge                                                                                                                                                                                                 | no — pre-existing test-infra flakiness unrelated to merge content; **action item**: re-run the full suite once more as part of T13's final verification and confirm it's not actually deterministic before shipping                                                                                                                                       |
| B5  | `apps/admin-ui/src/pages/entity-types/instance-create.test.tsx` was an add/add conflict — HEAD's narrower 80-line regression test (isSystem:true title field must still render) was dropped in favor of tushar's 405-line comprehensive mandate-fields suite, which never exercises `isSystem: true`                                                                                                                                                                                              | Time constraint mid-merge; the underlying component merged cleanly (non-conflicting) so the actual fix is presumably still in place, but no test asserts it anymore                                                                                                                                                                                                            | no — not a recurring pattern, but **action item**: add a standalone `isSystem: true` title-field-renders regression test to this file, adapted to tushar's current mocking pattern, before considering T13 (full verification) complete                                                                                                                   |
| B4  | `apps/admin-ui/src/components/layout.test.tsx`'s pre-existing (unconflicted) mock of `authProvider.js` didn't export `getRolesFromProfile` at all, and `mockUserWithRoles` built a Zitadel-namespaced-claim (`urn:zitadel:iam:org:project:roles`) test fixture even though `getRolesFromProfile`'s real implementation reads AuthNexus's `nexus_projects[].roles` shape — found only because running the test surfaced an unhandled-rejection crash, unrelated to any merge conflict in this file | Pre-existing bug in this tree, predating the tushar merge entirely — the mock was never updated when `getRolesFromProfile` was written/changed to its current AuthNexus-native shape                                                                                                                                                                                           | **yes → promoted to §V**: any test mock of `authProvider.js` must build role claims under `nexus_projects[].roles`, never a Zitadel-namespaced claim name, and must export every function the code under test actually imports from that module, not just the ones the mock's author remembered                                                           |
| B3  | `git merge origin/tushar` produced 31 conflicted files, far beyond §C's assumed auth-only conflict surface — `packages/db/src/schema/{entity-engine,platform,workflow-engine}.ts`, `packages/entity-engine/src/*`, `packages/workflow-engine/src/*`, `packages/audit/src/*`, `docker-compose.yml`, `docs/sup-docs/roadmap-tracker.md` (modify/delete), several third-party isolation tests (add/add), `pnpm-lock.yaml` — aborted per T1's rollback clause before committing anything              | The spec's scope_paths and conflict-risk assessment were written from the handoff doc's auth-focused framing and didn't account for `tushar`'s 99 commits also modifying shared core-engine/schema files that `new` has independently evolved since the `4c2d1324` sync point (both branches touched entity-engine/workflow-engine/audit for unrelated reasons in the interim) | **yes → promoted to §V**: any future merge/rebase of a long-diverged branch into `new` must be scoped (or at minimum surveyed with `git diff --stat` / `git log --name-only`) against the _actual_ conflict surface before committing to a scope_paths list, not just the surface a handoff doc described                                                 |

---

_spec is source of truth — update as decisions are made_
