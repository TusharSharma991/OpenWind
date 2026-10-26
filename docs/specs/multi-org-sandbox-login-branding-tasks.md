# Implementation Plan: Login-page branding by org slug (R13)

**Spec:** docs/specs/multi-org-sandbox.md (§R13, §V, §T Phase 5, T33–T40)
**Generated:** 2026-10-26
**Status:** implemented on `feat/login-org-branding` (local; PR opens after #1077 merges)
**Dependency:** needs `tenants.logo` and the name edit from PR #1077. Built on the local branch
`feat/login-org-branding` (off `feat/sandbox-branding`); the PR is opened only after #1077 merges,
replaying these commits with `git rebase --onto upstream/main <#1077 tip>`.

---

## Phase 1 — Data and view

**Goal:** a platform admin can read a sandbox's slug, and nothing else new.
**Gate:** db unit tests pass, migration applies on a throwaway Postgres

| task                                                           | requirement | status |
| -------------------------------------------------------------- | ----------- | ------ |
| T33: migration `GRANT SELECT (slug)` to `platform_admin_role`  | R13, R2     | done   |
| T34: `slug` on the sandbox view and every select that feeds it | R13         | done   |

## Phase 2 — API

**Goal:** an unauthenticated brand lookup, and the slug in the handover.
**Gate:** route tests pass + Phase 1 gate still green

| task                                                                  | requirement | status |
| --------------------------------------------------------------------- | ----------- | ------ |
| T35: `GET /public/org-branding/:slug` with its own limiter and config | R13         | done   |
| T36: handover response carries the sandbox's slug                     | R13         | done   |

## Phase 3 — UI, isolation, review

**Goal:** a branded login link works end to end, and the admin can copy it.
**Gate:** §R13 acceptance criteria met; full exit condition green

| task                                                                 | requirement | status |
| -------------------------------------------------------------------- | ----------- | ------ |
| T37: login page reads `?org=` and shows the brand                    | R13         | done   |
| T38: copyable login link; link in handover CSV, clipboard and reveal | R13         | done   |
| T39: isolation tests                                                 | R13, R2     | done   |
| T40: `/security-review`, docs                                        | R13         | done   |

---

## Kick-Off Prompt

Read docs/specs/multi-org-sandbox.md (§R13, Phase 5) and this file. Implement Phase 1 (T33, T34)
first. Do not start Phase 2 until Phase 1 tests pass. Stop and ask on any decision the spec does not
cover. Do not push this branch; the PR waits for #1077 to merge. Log failures with `/spec amend §B`.
