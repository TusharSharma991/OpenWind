# SSRF + PII Hardening

> Close SSRF and PII leakage gaps before any tenant data lands. Pilot blocker.

status: draft
created: 2026-05-22
updated: 2026-05-22
gh: #2

---

## §G Goal

- Outbound webhooks cannot reach internal infrastructure
- PII/financial field values never appear verbatim in `workflow_events` or analytics queries
- `analytics_user` grant scope is explicitly enumerated and maintained

---

## §C Constraints

| constraint   | value                                                                                  |
| ------------ | -------------------------------------------------------------------------------------- |
| stack        | PostgreSQL RLS, Drizzle, Hono, automation engine webhook action                        |
| auth         | `analytics_user` is a read-only DB role with `BYPASSRLS` — must be scoped down         |
| out of scope | Per-tenant PII classification UI (Phase 3); encryption-at-rest for PII fields (future) |
| gate         | Must merge before any pilot customer data is written to the platform                   |

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
127.0.0.0/8      loopback
::1/128           loopback IPv6
10.0.0.0/8        RFC 1918
172.16.0.0/12     RFC 1918
192.168.0.0/16    RFC 1918
169.254.0.0/16    link-local (AWS metadata)
fd00::/8          ULA IPv6
[platform private CIDRs from env: SSRF_BLOCK_CIDRS]
```

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

R1: All outbound webhook targets are validated against the block list after DNS resolution before any network request is made.
✓ Webhook action targeting `http://169.254.169.254/` is blocked; no network request is made
✓ Webhook action targeting a hostname that DNS-resolves to a RFC 1918 address is blocked
✓ Webhook action targeting a legitimate public URL proceeds normally
✓ Block list includes env-configurable private CIDRs (`SSRF_BLOCK_CIDRS`) in addition to hardcoded RFC ranges

R2: Every blocked webhook attempt is logged with tenantId, target URL, resolved IP, and reason.
✓ Blocked attempt produces a `webhook.blocked` log entry with all four fields
✓ No error details leak to the tenant-facing API response (generic "webhook delivery failed")

R3: DNS rebinding is mitigated — IP is re-checked at connection time, not only on initial resolution.
✓ If OS/Node resolves the same hostname to a different IP on retry, the second IP is also checked against the block list

**PII redaction**

R4: `entity_fields.sensitivity` classifies each field as `public | internal | pii | financial`. Default: `internal`.
✓ Migration adds column with correct default; existing rows retain behaviour
✓ Seed SQL for all existing fields ships with explicit sensitivity values

R5: When writing to `workflow_events.metadata`, values for `pii` and `financial` fields are replaced with `"[REDACTED]"`. Field names are retained.
✓ A `workflow_events` row for a transition that updated an SSN field contains `{ "ssn": "[REDACTED]" }`, not the value
✓ `public` and `internal` field values are written verbatim
✓ Redaction happens in the engine before the DB write — never after

R6: `analytics_user` has an explicit `GRANT SELECT` list. PII/financial columns and JSONB paths are excluded or exposed via masking view.
✓ `analytics_user` cannot SELECT `workflow_events.metadata` directly — a masking view is required
✓ A migration enumerates the grant list; any new table requires explicit opt-in comment in the migration PR checklist
✓ ADR-001 is updated with an addendum documenting the grant scope

---

## §V Invariants

- Outbound HTTP is never made to an unvalidated URL
- `workflow_events.metadata` never contains raw PII or financial values
- `analytics_user` grant list is the floor, not the ceiling — new tables default to no access
- Sensitivity default is `internal`, not `public` — explicit opt-in to expose

---

## §T Tasks

| id  | task                                                                                                                                                                      | phase | status | depends |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------ | ------- |
| T1  | Add `SSRF_BLOCK_CIDRS` env var to `@platform/config`                                                                                                                      | 1     | todo   | —       |
| T2  | Implement `validateWebhookUrl(url)` in `@platform/automation-engine` — resolves DNS, checks all block list ranges, throws typed `AutomationError('WEBHOOK_SSRF_BLOCKED')` | 1     | todo   | T1      |
| T3  | Wire `validateWebhookUrl` into webhook action executor; log blocked attempts                                                                                              | 1     | todo   | T2      |
| T4  | Unit tests: loopback, RFC1918, link-local blocked; public URL passes; DNS rebinding blocked                                                                               | 1     | todo   | T3      |
| T5  | Migration: add `entity_fields.sensitivity` column + default                                                                                                               | 2     | todo   | —       |
| T6  | Update workflow engine `writeEventLog` to redact `pii`/`financial` field values before insert                                                                             | 2     | todo   | T5      |
| T7  | Unit tests: redaction for pii/financial; verbatim for public/internal                                                                                                     | 2     | todo   | T6      |
| T8  | Migration: enumerate `analytics_user` GRANT SELECT list; create masking view for `workflow_events`                                                                        | 2     | todo   | T5      |
| T9  | Update all existing entity field seed SQL with explicit sensitivity values                                                                                                | 2     | todo   | T5      |
| T10 | ADR-001 addendum: document analytics_user grant scope                                                                                                                     | 2     | todo   | T8      |
| T11 | Isolation test: cross-tenant webhook blocked; analytics_user cannot read raw metadata                                                                                     | 3     | todo   | T4,T8   |

phase gate: all unit + integration tests pass before advancing to next phase

## §B Bugs / Backprop Log

| id  | what failed | root cause | promoted to §V? |
| --- | ----------- | ---------- | --------------- |
