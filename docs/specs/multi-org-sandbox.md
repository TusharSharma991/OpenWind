# Multi-Org Sandbox System

> On-demand, isolated trial orgs for prospects — platform admin spins one up, hands it over, resets
> or deletes it later. For sales/demo use.

status: draft
created: 2026-10-05
updated: 2026-10-05

---

## §G Goal

Platform admin creates a fully working, isolated sandbox tenant (org + real seeded users + org
chart + seeded module data) in a few clicks, hands login details to an external prospect for a
real trial or live demo, and later resets or deletes it. No cross-sandbox / cross-tenant leakage.
Works identically local + server.

**Blocking prerequisite — not a task in §T:** the `platform_admin` role is a new, cross-tenant
architectural pattern (first in this codebase). Per CLAUDE.md, a human-authored ADR is required
before Stage 1 implementation begins. Claude does not write this ADR.

## §C Constraints

| constraint   | value                                                                                                                                                                                        |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| stack        | Hono API, Drizzle+Postgres (RLS), BullMQ worker, Zitadel (shared project, new org per sandbox), Refine/shadcn admin-ui                                                                       |
| auth         | `platform_admin` = Zitadel role claim, same OIDC mechanism as `admin`/`agent`/`user`, but NOT tenant-scoped — dedicated `/platform-admin` login route, required TOTP MFA                     |
| tenancy      | each sandbox = 1 real `tenants` row + 1 real Zitadel org, same isolation guarantees (RLS + explicit `tenant_id`) as any customer tenant                                                      |
| out of scope | self-serve signup; in-app cross-tenant data/log viewer; auto-deletion of expired data; randomized org _shapes_ (names only); conversion-to-paid automation; support impersonation capability |
| perf         | provisioning (~21+ Zitadel calls) shows live progress, not a single long-held request — built as a trackable/resumable job, polled by the UI                                                 |

## §I Interfaces

```
POST   /platform-admin/sandboxes                 -> starts provisioning job, returns job id
GET    /platform-admin/sandboxes/:jobId/progress -> polled by wait-screen {step, total, status}
GET    /platform-admin/sandboxes                 -> list (metadata only: name, created, trial status)
GET    /platform-admin/sandboxes/:tenantId        -> read metadata (no business data)
POST   /platform-admin/sandboxes/:tenantId/reset  -> wipes+reseeds module data, cancels queued jobs
DELETE /platform-admin/sandboxes/:tenantId        -> purges OpenWind data + deletes Zitadel org/accts
```

Sandbox creation payload: `{ orgName, trialDays, modules: string[] }` (modules = which of the 7
core modules get auto-forked+seeded; all 7 remain visible in the catalog regardless).

Key entities (new):

- `tenants.is_sandbox: boolean`
- `tenants.trial_ends_at: timestamp | null`
- `tenants.created_by_platform_admin: text` (actor id, for the completed-action record)
- a per-action record (create/delete/reset only — see R9) — table/shape TBD in task breakout, not
  the existing tenant-scoped `admin_audit_log` (that table requires a tenant to exist already;
  platform-admin actions may need to attach to the sandbox's own tenant row once created, per R9).

## §R Requirements

R1: Platform admin is a distinct, non-tenant-scoped role, issued by Zitadel like every other role.
✓ A Zitadel token carrying `platform_admin` is recognized by the backend without requiring a
`zitadel_org_id` → tenant mapping to exist (the normal tenant-resolution step is skipped for it).
✓ `/platform-admin` is a separate login route from `/login`; successful auth routes to a dedicated
dashboard, never the normal tenant-scoped admin-ui shell.
✓ Logging into `/platform-admin` requires TOTP MFA.
✓ A documented local-dev bypass for the MFA requirement exists, and the app refuses to start with
that bypass enabled while `NODE_ENV=production` (same guarantee as the existing
`DEV_TENANT_ID`/`AUTH_DEV_MODE` pattern).

R2: Platform admin's powers are limited to sandbox lifecycle only, never business-data access.
✓ Platform admin can create, list, read metadata of, reset, and delete sandboxes.
✓ No route reachable by `platform_admin` returns any sandbox's business data (tickets, org chart
contents, audit entries) — only tenant-level metadata (name, created date, trial status).

R3: Creating a sandbox provisions a real, isolated org with a believable team.
✓ A new Zitadel organization is created under the existing shared Zitadel project — no new env
vars/credentials are introduced per sandbox.
✓ A matching `tenants` row is created with `is_sandbox = true` and the given `trial_ends_at`.
✓ 1 admin + 10–20 real Zitadel accounts are created, following a fixed org template (one shape,
reused every time); names are randomized realistic human names each time, never placeholder
strings.
✓ Username/email collisions (Zitadel uniqueness is instance-wide) are handled by generate-and-retry
until an unused one is accepted — no pre-check/reservation table.
✓ Every seeded account requires a password change on first login (built-in Zitadel policy); initial
password follows the agreed default pattern.
✓ The org-directory sync (existing feature, unchanged) seeds the chart from this data; the seeded
admin account has no manager and therefore attaches directly under the synthetic root — the top
real position in the chart — using existing org-directory logic with no modification.

R4: The platform admin chooses which modules arrive pre-populated.
✓ All 7 core modules (`crm`, `helpdesk`, `hrms`, `invoicing`, `procurement`, `projects`,
`reimbursements`) are visible in a sandbox's Modules catalog, same as any normal tenant.
✓ At creation time, the admin selects (checkbox/toggle) which of those 7 get auto-forked into a
live, seeded workflow; unselected ones remain visible/forkable by the prospect but start empty.
✓ Selected modules are seeded with a realistic amount of ticket data across workflow states, not
just one or two records.
✓ Selected modules' automation rules (SLA escalation, notification triggers) are also seeded —
acknowledged as requiring real per-module design, not a generic/free extension of ticket seeding.

R5: Provisioning is visible and resumable, not a single fragile long request.
✓ The platform admin sees a wait screen with a live progress indicator (e.g. "creating user
7/20") while a sandbox is created.
✓ Provisioning runs as a trackable job with step-by-step progress persisted as it happens; the
wait-screen polls this job rather than holding one HTTP connection open for the full duration.
✓ A failure partway through records where it got to, rather than leaving no information behind.

R6: Trial expiry stops everything for that tenant, without deleting data.
✓ `trial_ends_at` is stored per tenant.
✓ Every login attempt, every authenticated API request, and every background job touching a
tenant-scoped resource checks "is now past this tenant's `trial_ends_at`?" directly — no
separate scheduled job flips a precomputed status flag.
✓ Past expiry: login is refused; background jobs for that tenant (sync, schedule-rule ticket
creation, SLA timers, notification dispatch) no-op.
✓ Sandbox data is never auto-deleted on expiry — it persists until an explicit delete action.

R7: Reset returns a sandbox to a clean working state without disturbing its identity.
✓ Resetting a sandbox wipes and re-seeds only module/business data (tickets, workflow instances,
automation-execution history) — org chart, accounts, and credentials are untouched.
✓ Any pending queued background work for that tenant (scheduled notifications, automation
follow-ups) is cancelled as part of reset — nothing fires afterward referencing wiped data.

R8: Deleting a sandbox removes it from both OpenWind and the identity provider.
✓ Delete purges the tenant's OpenWind data via the same mechanism used for GDPR tenant erasure
(`apps/worker/src/tenant-purge.ts`), behind an explicit confirmation step.
✓ Delete also removes the corresponding Zitadel organization and every account under it — no
orphaned Zitadel accounts survive a deleted sandbox.

R9: A simple record exists of completed platform-admin actions; failed attempts are not logged.
✓ Creating, deleting, or resetting a sandbox (successfully) produces a record of who did it, which
sandbox, and when.
✓ A failed or abandoned creation attempt produces no separate audit record (the admin already saw
it live via R5's progress UI); failures surface through normal error-tracking/ops tooling only.

R10: Internal tooling can distinguish sandboxes from real tenants.
✓ `tenants.is_sandbox` exists and is set `true` for every sandbox, `false`/absent for real tenants.
✓ Internal usage/reporting dashboards can filter on this flag (verifying this doesn't require new
dashboard work in this spec — just that the flag is queryable).

## §V Invariants

- A `platform_admin`-authenticated request never resolves to, or is scoped by, any single tenant's
  `tenant_id` the way every other role's request is — it is cross-tenant by design, and every route
  it can reach must be explicitly reviewed for this (§security-review mandatory, no exceptions).
- No route reachable by `platform_admin` ever returns a sandbox's business data — only lifecycle
  metadata. This is the single invariant the entire risk-containment argument for this role rests
  on; any future PR adding a `platform_admin`-reachable route must be checked against it.
- Trial-expiry status is always computed live from `trial_ends_at` at the moment of check — never
  cached/stored as a separate boolean that could go stale relative to the timestamp.
- A sandbox's seeded accounts are real, working Zitadel accounts subject to the same uniqueness and
  policy rules as any real customer's accounts — never a parallel/fake identity mechanism.

## §T Tasks

**Blocking, not a Claude task:** human-authored ADR for the `platform_admin` cross-tenant role,
covering at minimum: where the role claim is recognized in the auth path, the Postgres/RLS
mechanism for its cross-tenant writes, and sign-off that the risk-containment model in §V is
sufficient. Stage 1 does not start until this ADR is approved.

## Phase 1 — Foundation

**Goal:** platform-admin role is recognized end-to-end; sandbox data model exists.
**Gate:** isolation tests pass showing a `platform_admin` token cannot read any tenant's business
data, and a normal tenant's request is unaffected by the new code paths.

| id  | task                                                                                                                                                        | phase | status | depends |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------ | ------- |
| T1  | `tenants.is_sandbox`, `tenants.trial_ends_at` columns + migration                                                                                           | 1     | todo   | ADR     |
| T2  | Auth: recognize `platform_admin` Zitadel role claim, skip tenant-resolution for it                                                                          | 1     | todo   | ADR     |
| T3  | `/platform-admin` login route + TOTP MFA requirement + documented, production-guarded local-dev bypass                                                      | 1     | todo   | T2      |
| T4  | Dedicated service-account Zitadel credential for provisioning (separate from the existing read-only one), scoped as narrowly as Zitadel's role model allows | 1     | todo   | —       |
| T5  | Verify Zitadel email-verification/password-policy settings are compatible with directly-set passwords + forced-change-on-first-login                        | 1     | todo   | T4      |

## Phase 2 — Provisioning

**Goal:** a sandbox can be created end-to-end with seeded org chart and module data.
**Gate:** integration test creates a sandbox and confirms org chart + selected modules are
populated; Phase 1 gate still green.

| id  | task                                                                                                            | phase | status | depends |
| --- | --------------------------------------------------------------------------------------------------------------- | ----- | ------ | ------- |
| T6  | Fixed org template (roles/departments) + randomized realistic-name generator + hit-and-retry collision handling | 2     | todo   | T4      |
| T7  | Provisioning job: create org, create accounts w/ metadata, trigger org-directory sync                           | 2     | todo   | T6      |
| T8  | Trackable job progress persistence + polling endpoint (R5)                                                      | 2     | todo   | T7      |
| T9  | Module-seed data: tickets/records across workflow states for each selectable core module                        | 2     | todo   | T7      |
| T10 | Per-module automation-rule seeding                                                                              | 2     | todo   | T9      |
| T11 | Decide + implement retry-vs-rollback behavior for partial provisioning failure                                  | 2     | todo   | T8      |

## Phase 3 — Lifecycle & Admin Surface

**Goal:** full lifecycle (expiry, reset, delete) works; platform admin has a working dashboard.
**Gate:** §R acceptance criteria met end-to-end; isolation tests cover expired-tenant access
rejection and reset/delete cross-tenant safety.

| id  | task                                                                                                                                        | phase | status | depends           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------ | ----------------- |
| T12 | Trial-expiry check: login path + per-request middleware + background-job guard (R6)                                                         | 3     | todo   | T1                |
| T13 | Reset: wipe+reseed module data, cancel queued background work for that tenant (R7)                                                          | 3     | todo   | T9, T10           |
| T14 | Delete: confirm `tenant-purge.ts`'s current behavior (hard delete vs anonymize) matches "delete this org's data" here; adjust if not        | 3     | todo   | —                 |
| T15 | Delete: also remove the Zitadel org + accounts (R8)                                                                                         | 3     | todo   | T14               |
| T16 | Completed-action record for create/delete/reset (R9) — resolve where this is written given create's chicken-and-egg tenant-existence timing | 3     | todo   | —                 |
| T17 | Platform-admin dashboard: create (with module checkboxes + progress screen), list, view status, reset, delete                               | 3     | todo   | T8, T12, T13, T15 |
| T18 | `/security-review`: platform-admin cross-tenant write path, RLS/GUC interaction, MFA bypass guard                                           | 3     | todo   | T17               |

phase gate: all unit + integration tests pass before advancing to next phase; isolation tests
required in every phase touching tenant-scoped data or new routes (`db-conventions.md`,
`testing-conventions.md`).

## §B Bugs / Backprop Log

| id  | what failed | root cause | promoted to §V? |
| --- | ----------- | ---------- | --------------- |
| —   | —           | —          | —               |

---

_spec is source of truth — update as decisions are made. Full requirements-capture history (3
rounds of `/interview-me`, including rejected/corrected claims) lives in
`C:\Users\User\Desktop\Tushar\OFF\work docs\OW\multi-org\sandbox-orgs-intent.md`, outside this
repo — not duplicated here._
