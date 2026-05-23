# SSRF + PII Hardening

> Close SSRF and PII leakage gaps before any tenant data lands. Pilot blocker.

status: draft
created: 2026-05-22
updated: 2026-05-23
reviewed: 2026-05-22
gh: #2

---

## §G Goal

- Outbound webhooks cannot reach internal infrastructure
- PII/financial field values never appear verbatim in `workflow_events` or analytics queries
- `analytics_user` grant scope is explicitly enumerated and maintained

---

## §C Constraints

| constraint   | value                                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| stack        | PostgreSQL RLS, Drizzle, Hono, automation engine webhook action                                                                                                                                  |
| auth         | `analytics_user` is a read-only DB role with `BYPASSRLS` — must be scoped down                                                                                                                   |
| out of scope | Per-tenant PII classification UI (Phase 3); encryption-at-rest for PII fields (future); SSRF protection for entity URL-type fields, connector polling URLs, or file source URLs (separate track) |
| gate         | Must merge before any pilot customer data is written to the platform                                                                                                                             |
| dns timeout  | Max 2s for DNS resolution in `validateWebhookUrl`; treat timeout as block                                                                                                                        |

---

## §I Interfaces

### New DB column

```sql
-- on entity_fields
sensitivity TEXT NOT NULL DEFAULT 'internal'
  CHECK (sensitivity IN ('public', 'internal', 'pii', 'financial'))
```

### SSRF block list (resolved IP ranges)

```
127.0.0.0/8        loopback IPv4
::1/128            loopback IPv6
10.0.0.0/8         RFC 1918
172.16.0.0/12      RFC 1918
192.168.0.0/16     RFC 1918
169.254.0.0/16     link-local / AWS metadata (IPv4)
fe80::/10          link-local (IPv6)
100.64.0.0/10      CGNAT / shared address space
fd00::/8           ULA IPv6
::ffff:0:0/96      IPv4-mapped IPv6 (covers ::ffff:10.x, ::ffff:169.254.x, etc.)
[platform private CIDRs from env: SSRF_BLOCK_CIDRS]
```

> **DNS pinning:** After resolving the URL and validating the IP, the outbound HTTP request must be made to the _already-resolved IP address_ (not re-resolved from the hostname) with the `Host` header set to the original hostname. This prevents DNS rebinding where the hostname returns a safe IP on lookup but a blocked IP at connection time.

> All addresses must be normalized to their canonical form before range-checking. IPv4-mapped IPv6 addresses must be extracted to their IPv4 value and checked against IPv4 ranges.

### Audit log entry (blocked webhook)

```json
{
  "tenantId": "...",
  "targetUrl": "http://169.254.169.254/...",
  "resolvedIp": "169.254.169.254",
  "reason": "link-local",
  "action": "webhook.blocked"
}
```

---

## §R Requirements

**SSRF**

R1: No outbound webhook request is made to any URL that resolves to a blocked address range.
✓ Webhook action targeting `http://169.254.169.254/` is blocked; no network request is made
✓ Webhook action targeting a hostname that DNS-resolves to a RFC 1918 address is blocked
✓ Webhook action targeting `::ffff:169.254.169.254` (IPv4-mapped IPv6) is blocked
✓ Webhook action targeting `100.64.x.x` (CGNAT) or `fe80::/10` (IPv6 link-local) is blocked
✓ Webhook action targeting a legitimate public URL proceeds normally
✓ Block list includes env-configurable private CIDRs (`SSRF_BLOCK_CIDRS`) in addition to hardcoded RFC ranges
✓ DNS resolution that exceeds 2s is treated as a block; delivery does not hang
✓ Outbound request is made directly to the validated IP (not re-resolved from hostname); `Host` header preserves original hostname — DNS rebinding cannot substitute a blocked IP after validation

R2: Every blocked webhook attempt is logged with tenantId, target URL, resolved IP, and reason.
✓ Blocked attempt produces a `webhook.blocked` log entry with all four fields
✓ No error details leak to the tenant-facing API response (generic "webhook delivery failed")

R3: A webhook URL that passed validation at request time is blocked if it resolves to a blocked address at delivery time.
✓ A webhook configured with a hostname that returns a permitted IP at validation but a blocked IP at delivery is blocked and not delivered
✓ Blocked delivery is logged with the same fields as a validation-time block (R2)

**PII redaction**

R4: `entity_fields.sensitivity` classifies each field as `public | internal | pii | financial`. Default: `internal`.
✓ Migration adds column with correct default; existing rows retain behaviour
✓ Seed SQL for all existing fields ships with explicit sensitivity values

R5: When writing to `workflow_events.metadata`, values for `pii` and `financial` fields are replaced with `"[REDACTED]"`. Field names are retained.
✓ A `workflow_events` row for a transition that updated an SSN field contains `{ "ssn": "[REDACTED]" }`, not the value
✓ `public` and `internal` field values are written verbatim
✓ Redaction applies to top-level keys of `metadata` only — the engine does not traverse nested objects within a field value; non-field metadata keys (e.g. `comment`, `triggeredBy`) are never redacted
✓ Redaction happens in the engine before the DB write — never after

R6: `analytics_user` cannot read raw PII or financial values from any platform table.
✓ `analytics_user` cannot read raw `pii` or `financial` field values from `workflow_events` — a read attempt returns no such data
✓ An explicit grant list enumerates exactly which tables and columns `analytics_user` may access; all other tables default to no access
✓ A CI lint rule fails if a new migration file adds a table without an explicit `-- analytics: excluded` or `-- analytics: included(col1,col2)` annotation
✓ ADR-001 is updated with an addendum documenting the grant scope and opt-in convention

---

## §V Invariants

- Outbound HTTP is never made to an unvalidated URL
- DNS resolution timeout (2s) is treated as a block — no hang on slow DNS
- IPv4-mapped IPv6 addresses are normalized and checked against IPv4 block ranges before any request
- `workflow_events.metadata` never contains raw PII or financial values
- `analytics_user` grant list is the floor, not the ceiling — new tables default to no access
- Sensitivity default is `internal`, not `public` — explicit opt-in to expose

---

## §T Tasks

| id  | task                                                                                                                                                                                                                                                                             | phase | status | depends  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------ | -------- |
| T1  | Add `SSRF_BLOCK_CIDRS` env var to `@platform/config`                                                                                                                                                                                                                             | 1     | todo   | —        |
| T2  | Implement `validateWebhookUrl(url)` in `@platform/automation-engine` — resolves DNS (2s timeout via `AbortController`), normalizes IPv4-mapped IPv6, checks all block list ranges, throws typed `AutomationError('WEBHOOK_SSRF_BLOCKED')`; returns resolved IP for use by caller | 1     | todo   | T1       |
| T3  | Wire `validateWebhookUrl` into webhook action executor; use returned IP to construct request (pin connection, set `Host` header to original hostname); log blocked attempts                                                                                                      | 1     | todo   | T2       |
| T4  | Unit tests: loopback, RFC1918, link-local, IPv4-mapped IPv6 blocked; public URL passes; DNS timeout treated as block; DNS rebinding blocked (mock DNS returns different IP on second call)                                                                                       | 1     | todo   | T3       |
| T5  | Migration: add `entity_fields.sensitivity` column + default                                                                                                                                                                                                                      | 2     | todo   | —        |
| T6  | Update workflow engine `writeEventLog` to redact `pii`/`financial` field values before insert                                                                                                                                                                                    | 2     | todo   | T5       |
| T7  | Unit tests: redaction for pii/financial; verbatim for public/internal                                                                                                                                                                                                            | 2     | todo   | T6       |
| T8  | Migration: enumerate `analytics_user` GRANT SELECT list; create masking view for `workflow_events`                                                                                                                                                                               | 2     | todo   | T5       |
| T9  | Update all existing entity field seed SQL with explicit sensitivity values (one sub-task per module — scope: ~7 modules, est. 30–60 fields total)                                                                                                                                | 2     | todo   | T5       |
| T10 | ADR-001 addendum: document analytics_user grant scope and opt-in convention                                                                                                                                                                                                      | 2     | todo   | T8       |
| T11 | Isolation test: cross-tenant webhook blocked; analytics_user cannot read raw metadata                                                                                                                                                                                            | 3     | todo   | T4,T7,T8 |
| T12 | CI lint rule: fail if migration file lacks `-- analytics: excluded` or `-- analytics: included(...)` annotation (grep check in pre-commit / CI script)                                                                                                                           | 2     | todo   | T8       |
| T13 | Remove `analytics_user` blanket `GRANT SELECT ON api_keys` from migration 0001 — was overreach; replace with explicit column-level grant per T8 policy                                                                                                                           | 3     | todo   | T8       |

phase gate: all unit + integration tests pass before advancing to next phase

## §B Bugs / Backprop Log

| id  | what failed | root cause | promoted to §V? |
| --- | ----------- | ---------- | --------------- |
