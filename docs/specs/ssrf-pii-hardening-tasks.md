# Implementation Plan: SSRF + PII Hardening

**Spec:** `docs/specs/ssrf-pii-hardening.md`
**Generated:** 2026-05-22
**Status:** not started
**GH issue:** #2 (closed — tracked as pilot blocker pre-merge)
**Branch:** `fix/PLAT-2-ssrf-pii-hardening` (suggested)

---

## Phase 1 — SSRF Guard

**Goal:** No outbound webhook can reach internal infrastructure; DNS rebinding is closed.
**Gate:** all unit tests for `validateWebhookUrl` pass (blocked ranges, DNS timeout, rebinding, public URL) → then Phase 2

| task | description                                                                                                                                                                                                                                                                                                                                                                                                                  | requirement | status |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ |
| T1   | Add `SSRF_BLOCK_CIDRS` (comma-separated, optional) + `CLAMAV_HOST` + `CLAMAV_PORT` env vars to `packages/config/src/env.ts`                                                                                                                                                                                                                                                                                                  | R1          | todo   |
| T2   | `packages/automation-engine/src/ssrf-guard.ts` — `validateWebhookUrl(url, env)`: DNS resolve (2s `AbortController` timeout), normalize IPv4-mapped IPv6 via `ipaddr.js`, check all blocked CIDRs, throw `AutomationError('WEBHOOK_SSRF_BLOCKED', {url, resolvedIp, reason})` on match; return validated IP for caller                                                                                                        | R1, R2, R3  | todo   |
| T3   | `packages/automation-engine/src/actions/webhook.ts` — new webhook action: call `validateWebhookUrl`, construct a one-shot `https.Agent` with `lookup` callback pinned to the validated IP (URL + `Host` header unchanged, TLS SNI preserved), POST payload, log `webhook.blocked` on `AutomationError('WEBHOOK_SSRF_BLOCKED')`                                                                                               | R1, R2, R3  | todo   |
| T4   | Wire `webhook` case into `executor.ts` `runAction` switch                                                                                                                                                                                                                                                                                                                                                                    | R1          | todo   |
| T5   | `packages/automation-engine/src/ssrf-guard.test.ts` — unit tests: loopback IPv4/IPv6 blocked; RFC 1918 blocked; link-local `169.254.x.x` blocked; IPv4-mapped IPv6 `::ffff:169.254.x.x` blocked; CGNAT `100.64.x.x` blocked; ULA `fd00::/8` blocked; valid public URL passes; DNS timeout (mock) treated as block; DNS rebinding (mock returns different IP on second call) blocked; `SSRF_BLOCK_CIDRS` custom range blocked | R1, R2, R3  | todo   |

**Notes:**

- `ipaddr.js` is the only new dependency — lightweight, well-maintained, covers IPv4-mapped IPv6 normalization correctly
- One-shot agent pattern: `new https.Agent({ lookup: (_hostname, _opts, cb) => cb(null, validatedIp, 4) })` — prevents second DNS lookup at TCP connect time
- `AutomationError('WEBHOOK_SSRF_BLOCKED')` maps to `degraded` execution status in executor audit log (same as circuit-open skip), not a hard failure that stops other actions

---

## Phase 2 — PII Redaction + Analytics Lockdown

**Goal:** `workflow_events.metadata` never stores raw PII/financial values; `analytics_user` has a locked-down, explicit grant list.
**Gate:** migration applies cleanly; redaction unit tests pass; `analytics_user` isolation test passes → then Phase 3

| task | description                                                                                                                                                                                                                                                                                                                                                                                        | requirement | status |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ |
| T6   | `packages/db/migrations/0008_entity_fields_sensitivity.sql` — `ALTER TABLE entity_fields ADD COLUMN sensitivity TEXT NOT NULL DEFAULT 'internal' CHECK (sensitivity IN ('public','internal','pii','financial'))` + down migration comment                                                                                                                                                          | R4          | todo   |
| T7   | Drizzle schema: add `sensitivity` column to `entityFields` table in `packages/db/src/schema/entity-engine.ts`                                                                                                                                                                                                                                                                                      | R4          | todo   |
| T8   | `packages/entity-engine/src/types.ts` — add `FieldSensitivity = "public" \| "internal" \| "pii" \| "financial"` type; add `sensitivity: FieldSensitivity` to `EntityField` interface                                                                                                                                                                                                               | R4          | todo   |
| T9   | `packages/entity-engine/src/entity-fields.ts` — add `sensitivity` to `rowToEntityField` mapper; include in `listEntityFields` and `updateEntityField` results; add `sensitivity` to `UpdateEntityFieldInput`                                                                                                                                                                                       | R4          | todo   |
| T10  | `packages/workflow-engine/src/redact.ts` — pure `redactMetadata(metadata, sensitivityMap)` function: replaces values (not keys) for `pii`/`financial` fields with `"[REDACTED]"`; `public`/`internal` pass through; non-field keys untouched                                                                                                                                                       | R5          | todo   |
| T11  | `packages/workflow-engine/src/redact.test.ts` — unit tests: pii field redacted; financial field redacted; public field verbatim; internal field verbatim; unknown key (no matching field) verbatim; empty map no-op; nested value is not traversed (only top-level)                                                                                                                                | R5          | todo   |
| T12  | `packages/workflow-engine/src/engine.ts` — before `workflow_events` INSERT in `executeTransition`: fetch field sensitivity map for the entity type; call `redactMetadata(request.metadata, sensitivityMap)` on the metadata before storing                                                                                                                                                         | R5          | todo   |
| T13  | `packages/db/migrations/0009_analytics_user_grants.sql` — `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM analytics_user`; explicit `GRANT SELECT (col1, col2, ...)` per table; remove blanket `GRANT SELECT ON api_keys TO analytics_user` from 0001 path; create `workflow_events_masked` view (per §I spec); `GRANT SELECT ON workflow_events_masked TO analytics_user` | R6          | todo   |
| T14  | `docs/decisions/ADR-001-multitenancy.md` — add "Analytics access policy" addendum: opt-in convention, `-- analytics: excluded \| included(col1,col2)` annotation requirement, masking view rationale                                                                                                                                                                                               | R6          | todo   |
| T15  | `CLAUDE.md` PR checklist — add item: "analytics_user access explicitly declared on all new tables (`-- analytics: excluded` or `-- analytics: included(...)` annotation in migration)"                                                                                                                                                                                                             | R6          | todo   |

**Notes:**

- Sensitivity map fetch in `executeTransition` should use the entity type from the loaded instance (already in scope at that point in engine.ts) — one extra DB read per transition, cached per request context
- `workflow_events_masked` view masks at query time (as fallback) but R5 requires redaction also happens at INSERT — both layers for defense in depth
- T13 migration must audit every existing table: `entity_instances`, `entity_fields`, `entity_types`, `workflow_events` (via view only), `workflows`, `workflow_states`, `workflow_transitions`, `outbox_events`, `dead_letter_events`, `automation_rules`, `automation_executions`, `tenants`, `api_keys`, `tenant_users`, `connector_credentials`

---

## Phase 3 — Isolation Tests + CI Enforcement

**Goal:** Automated proof that SSRF and PII guarantees hold across tenants; CI blocks any migration that forgets the analytics annotation.
**Gate:** §R acceptance criteria fully met; CI lint rule active

| task | description                                                                                                                                                                                                                                                                                                | requirement | status |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ |
| T16  | `apps/api/tests/isolation/ssrf-pii.isolation.test.ts` — isolation test: webhook action targeting `169.254.169.254` blocked and no network call; `analytics_user` DB connection cannot read raw `metadata` from `workflow_events` (must use view); cross-tenant entity ref still blocked (regression guard) | R1, R5, R6  | todo   |
| T17  | CI lint script (grep-based, add to `pnpm ci`): scan all `packages/db/migrations/*.sql` files for new `CREATE TABLE` statements; fail if the file lacks an `-- analytics:` annotation comment; print offending file + line                                                                                  | R6          | todo   |
| T18  | Remove `GRANT SELECT ON api_keys TO analytics_user` from migration 0001 body (superseded by T13) and add `-- analytics: included(id,tenant_id,name,scopes,last_used_at,created_at)` annotation to 0001                                                                                                     | R6          | todo   |

---

## Kick-Off Prompt

Copy this into your next Claude Code session to start implementation:

```
Read docs/specs/ssrf-pii-hardening.md and docs/specs/ssrf-pii-hardening-tasks.md.

Implement Phase 1 tasks only (T1–T5). Create a new branch fix/PLAT-2-ssrf-pii-hardening.

Key decisions already made in the spec:
- Use ipaddr.js for IP normalization (add to packages/automation-engine/package.json)
- One-shot https.Agent with lookup pinned to validated IP — do NOT rewrite the URL (TLS SNI must use original hostname)
- DNS timeout = 2s via AbortController; timeout throws AutomationError('DNS_RESOLUTION_TIMEOUT') — treated as block
- AutomationError('WEBHOOK_SSRF_BLOCKED') maps to degraded (not failed) in executor audit log
- webhook action file: packages/automation-engine/src/actions/webhook.ts (new file)

Rules:
- Do not begin Phase 2 until all Phase 1 tests (T5) pass
- After each task, run: pnpm --filter @platform/automation-engine test
- If you hit a decision not covered by the spec, stop and ask — do not assume
- If a test fails, note it for /spec amend §B before fixing
```

---

_After each implementation session:_

- _If tests failed: run `/spec amend §B` to log them_
- _If a bug pattern emerged that shouldn't repeat: run `/spec amend §V` to lock it in_
