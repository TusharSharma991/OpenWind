# Implementation Plan: Tushar → nexus-OW merge (AuthNexus adaptation)

**Spec:** docs/specs/tushar-authnexus-merge.md
**Generated:** 2026-09-28
**Status:** not started

---

## Phase 1 — Merge + call-site redirect

**Goal:** `tushar`'s 99 commits land on `new`, migrations run, and every real
`zitadel-management.ts` call site is redirected to `authnexus-management.ts` — no Zitadel
management-client import remains anywhere in the tree.
**Gate:** `pnpm typecheck && pnpm lint` clean; `git grep -l "zitadel-management" apps/ packages/`
returns zero hits (excluding the documented `notification-outbound-auth.ts` exception) → then
Phase 2.

| task                                                                                                                                                                                                                      | requirement | status |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ |
| T1: Merge `tushar` into `new`; resolve auth-layer conflicts in favor of existing AuthNexus code; abort via `git merge --abort` and re-scope if conflict resolution becomes unsafe before committing                       | R1          | todo   |
| T2: Run migrations `0085`-`0111` unmodified                                                                                                                                                                               | R7          | todo   |
| T3: Re-grep `origin/tushar`'s tip (`git grep -ln "zitadel-management"` + manual `@platform/auth`-import check) to confirm the 12-site list is still exhaustive; redirect all confirmed sites to `authnexus-management.ts` | R1          | todo   |
| T4: Delete/never-merge `zitadel-management.ts` and its `apps/api` re-export shim                                                                                                                                          | R1          | todo   |

---

## Phase 2 — Feature adaptation

**Goal:** On-call routing, mention resolution, user-ref resolution, and role listing all work
correctly against AuthNexus's actual data shape and caching, with the on-call role-key list and
GDPR erasure gap explicitly resolved (not silently assumed).
**Gate:** `pnpm test` + `pnpm test:isolation` pass; Phase 1 gate still green; T8 may remain open
(see below) without blocking this gate.

| task                                                                                                                                                                                                                   | requirement | status      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------- |
| T5: Thread `orgId` into `platform/roles.ts`'s `listProjectRoles` call                                                                                                                                                  | R2          | todo        |
| T6: Confirm on-call role-key list `["agent","admin","user"]` is safe for nexus-OW's AuthNexus org (no customer accounts mixed in); update R3's accepted value + code comment if not                                    | R3          | todo        |
| T7: Wire `validateScheduleRefs` tenant_users self-heal fallback against AuthNexus                                                                                                                                      | R4          | todo        |
| T8: **BLOCKED — human decision required.** Confirm whether AuthNexus exposes a user deactivate/disable admin call. Write to `BLOCKERS.md`, do not guess. Ship interim logging-visibility behavior (R6) in the meantime | R6          | **blocked** |
| T9: Verify `ensure-user-refs.ts` best-effort top-up semantics work against AuthNexus; add the distinct-failure-mode log line (§V)                                                                                      | R5          | todo        |
| T10: Add caching-parity test: N concurrent `listOrgUsers`/`listUserRolesByUserId`/`getUserById` calls for the same key → exactly one underlying `fetch`                                                                | R10         | todo        |
| T11: Run entity-fields detection query; backfill `title`/`team_id` for any legacy entity type found                                                                                                                    | R9          | todo        |
| T12: Confirm/insert `automation_rules` rows for any pre-existing tenant (module seed covers fresh tenants automatically)                                                                                               | R8          | todo        |

---

## Phase 3 — Verification & sign-off

**Goal:** Full exit condition green, §V invariant grep-verified, security review passed.
**Gate:** §R acceptance criteria met (except R6, which stays open pending T8's human decision).

| task                                                                                                                                                  | requirement | status |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ |
| T13: Full verification — `pnpm typecheck && pnpm lint && pnpm test && pnpm test:isolation`; run R1's exact grep command against the merged `new` tree | R1, R7      | todo   |
| T14: `/security-review` — auth-layer changes, per security.md mandate                                                                                 | all         | todo   |

---

## Kick-Off Prompt

Copy this into your Claude Code session to start implementation:

```
Read docs/specs/tushar-authnexus-merge.md and docs/specs/tushar-authnexus-merge-tasks.md.

Implement Phase 1 tasks only (T1-T4).

Rules:
- Do not begin Phase 2 until all Phase 1 tests pass and the zitadel-management.ts grep is clean
- After each task, run relevant tests and confirm pass before continuing
- If you hit a decision not covered by the spec, stop and ask — do not assume
- T8 in Phase 2 is a BLOCKED task requiring a human decision — do not attempt to resolve it
  autonomously; write to BLOCKERS.md when you reach it
- If a test fails, run: /spec amend §B to log it before fixing
- If the same bug class could recur, run: /spec amend §V to make it an invariant
```
