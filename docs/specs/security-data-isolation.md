# Security — Data Isolation & PII Leakage Gaps

> Close three high/medium severity gaps before any pilot customer data lands. Blocks Phase 2 onboarding.

status: draft
created: 2026-05-22
updated: 2026-05-22
gh-issue: #2
pilot-blocker: yes

---

## §G Goal

Three independent gaps, all must close before pilot:

1. **SSRF** — automation `webhook` action can be weaponised to reach internal infra
2. **PII in event log** — `workflow_events.metadata` stores full field payloads verbatim; sensitive values must be redacted at write time
3. **analytics_user scope** — BYPASSRLS role has undefined read access; must be locked to an explicit column allowlist

Done when: pentest finds no SSRF vector; a `pii`-tagged field value never appears verbatim in `workflow_events`; `analytics_user` grant list is exhaustive and documented.

---

## §C Constraints

| constraint       | value                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| stack            | TypeScript, Drizzle, Postgres, Node.js `fetch` for outbound HTTP                                  |
| packages touched | `packages/automation-engine`, `packages/workflow-engine`, `packages/entity-engine`, `packages/db` |
| ADRs             | ADR-001 (RLS/multitenancy), ADR-003 (field validation)                                            |
| out of scope     | Connector actions (3A), script actions, full egress firewall (infra)                              |
| perf             | SSRF check adds ≤5 ms per webhook call (DNS already resolves before dispatch)                     |
| immutability     | `workflow_events` rows are never mutated — redaction happens at INSERT, not retroactively         |

---

## §I Interfaces

### I1 — SSRF allowlist / blocklist

```
SsrfGuard.check(url: string): Promise<void>
  throws SsrfError("SSRF_BLOCKED", { url, reason, resolvedIp })
```

Blocked ranges (IANA reserved + cloud metadata):

- `127.0.0.0/8`, `::1` — loopback
- `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` — RFC 1918
- `169.254.0.0/16`, `fe80::/10` — link-local / AWS metadata
- `100.64.0.0/10` — CGNAT / shared address space
- `::ffff:0:0/96` — IPv4-mapped IPv6 (bypass attempt)

### I2 — Field sensitivity

New column on `entity_fields`:

```
sensitivity: "public" | "internal" | "pii" | "financial"
default: "internal"
```

`EntityField` type gains `sensitivity: FieldSensitivity`.

### I3 — PII redaction at event write

`TransitionRequest` passes field values → engine redacts before INSERT:

```
redactMetadata(
  metadata: Record<string, unknown>,
  fieldSensitivityMap: Map<string, FieldSensitivity>,
): Record<string, unknown>
```

`pii` | `financial` field values → `"[REDACTED]"`. Field keys retained.

### I4 — analytics_user explicit grant

Migration adds exhaustive `GRANT SELECT` per table per column. Every new migration that creates a tenant-scoped table must include an explicit analytics grant or explicit exclusion comment.

---

## §R Requirements

**— Item 1: SSRF —**

R1: Outbound webhook URLs validated against blocked IP ranges before any network call is made.
✓ URL is resolved to IP(s) via DNS; all resolved IPs checked against blocklist
✓ Blocked requests throw `SsrfError("SSRF_BLOCKED")` — no HTTP call is attempted
✓ `http://169.254.169.254/latest/meta-data/` is blocked; no network call observed in test

R2: DNS rebinding protected — IP check occurs after DNS resolution, not on raw URL hostname.
✓ A URL resolving to `10.x.x.x` at call time is blocked even if hostname appears external
✓ Redirect chains re-check the destination URL (follow-redirects not permitted without re-validation)

R3: All blocked webhook attempts logged at WARN with `tenantId`, `ruleId`, `targetUrl`, `resolvedIp`, `reason`.
✓ Logger call present; log entry observable in test output

R4: `webhook` action type absent from `ActionType` enum until SSRF guard is implemented and tested.
✓ Executor `switch` has no `webhook` case — unrecognised action falls to warn-and-skip

**— Item 2: PII redaction —**

R5: `entity_fields` gains `sensitivity` column; existing rows default to `"internal"`.
✓ Migration adds column with `DEFAULT 'internal' NOT NULL`
✓ `EntityField` TypeScript type includes `sensitivity` field
✓ `listEntityFields` / `updateEntityField` return `sensitivity` in result

R6: `workflow_events.metadata` never stores verbatim values for `pii` or `financial` fields.
✓ Engine loads field sensitivity map for the entity type before INSERT
✓ `redactMetadata` replaces values (not keys) for sensitive fields with `"[REDACTED]"`
✓ Unit test: metadata with `{ ssn: "123-45-6789" }` where `ssn` is `pii` → stored as `{ ssn: "[REDACTED]" }`
✓ Unit test: `public` / `internal` field values pass through unmodified
✓ Non-field keys in metadata (e.g. `comment`, `triggeredBy`) are never redacted

R7: Sensitivity not retroactively applied — existing `workflow_events` rows unchanged.
✓ No UPDATE/backfill migration for `workflow_events` (append-only table invariant preserved)

**— Item 3: analytics_user scope —**

R8: `analytics_user` has an explicit, exhaustive `GRANT SELECT` list in migration SQL.
✓ Every table accessible to `analytics_user` is listed with specific column grants
✓ Tables with PII/financial columns are excluded entirely OR exposed via a masking view
✓ `workflow_events.metadata` is not directly accessible to `analytics_user` (too broad); replaced by a masked view that strips `[REDACTED]` fields or exposes only non-sensitive metadata keys

R9: Future migrations follow a mandatory analytics-access pattern.
✓ New migration template includes a `-- analytics_user: GRANT ... | excluded (reason)` comment block
✓ CLAUDE.md PR checklist updated with "analytics_user access explicitly declared"

R10: ADR-001 addendum documents the grant policy, masking view approach, and per-table decisions.
✓ `docs/decisions/ADR-001-multitenancy.md` has new section "Analytics access policy"

---

## §V Invariants

- SSRF guard runs **after** DNS resolution — hostname-only checks are insufficient (DNS rebinding)
- Redaction is at INSERT time only — `workflow_events` rows are immutable; no retroactive masking
- Field key names are always retained in redacted metadata — consumers must know which fields exist
- `analytics_user` access to any new table must be explicitly declared in its migration — implicit access is denied
- `webhook` action must not be dispatched without SSRF guard active — unguarded webhook is a blocker for the action type shipping at all

---

## §T Tasks

| id  | task                                                                                                         | phase | status | depends |
| --- | ------------------------------------------------------------------------------------------------------------ | ----- | ------ | ------- |
| T1  | `packages/automation-engine/src/ssrf-guard.ts` — IP range blocklist + DNS resolution check                   | 1     | todo   | —       |
| T2  | Unit tests: SSRF guard — blocked ranges, DNS rebinding, loopback, IPv4-mapped IPv6, valid URL passes         | 1     | todo   | T1      |
| T3  | Wire guard into executor `webhook` case; add `webhook` to `ActionType` switch                                | 1     | todo   | T2      |
| T4  | Integration test: webhook action targeting `169.254.169.254` blocked, no network call                        | 1     | todo   | T3      |
| T5  | Migration: add `sensitivity` column to `entity_fields` (default `"internal"`)                                | 2     | todo   | —       |
| T6  | Drizzle schema + `EntityField` type + `FieldSensitivity` type                                                | 2     | todo   | T5      |
| T7  | `redactMetadata()` pure function + unit tests (all sensitivity levels, non-field keys untouched)             | 2     | todo   | T6      |
| T8  | Load field sensitivity map in `executeTransition` before `workflow_events` INSERT; call `redactMetadata`     | 2     | todo   | T7      |
| T9  | Engine tests: pii/financial values → `[REDACTED]`; public/internal pass through                              | 2     | todo   | T8      |
| T10 | Migration: explicit `GRANT SELECT` per table/column for `analytics_user`; masking view for `workflow_events` | 3     | todo   | T5      |
| T11 | Remove `analytics_user` blanket grant on `api_keys` from 0001 migration (was overreach)                      | 3     | todo   | T10     |
| T12 | ADR-001 addendum: analytics access policy                                                                    | 3     | todo   | T10     |
| T13 | CLAUDE.md PR checklist: "analytics_user access explicitly declared on all new tables"                        | 3     | todo   | T12     |

phase gate: all unit + integration tests pass before advancing to next phase

---

## §B Bugs / Backprop Log

| id  | what failed | root cause | promoted to §V? |
| --- | ----------- | ---------- | --------------- |
