# Read before touching

Moved out of `CLAUDE.md` to keep that file short. Before changing code in an area below, read the
ADR or doc listed for it. `CLAUDE.md` points here.

| Area                                                                                                 | Read                                                                                 |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Tenancy, RLS                                                                                         | ADR-001                                                                              |
| Workflow state machine                                                                               | ADR-002, `.claude/context/workflow-engine.md`                                        |
| Entity field validation                                                                              | ADR-003, `.claude/context/entity-engine.md`                                          |
| Anything under `modules/`                                                                            | ADR-004 (config-first)                                                               |
| Module category / auto-provisioning (`tender`, `optional`)                                           | ADR-005                                                                              |
| Workflow ownership / access grants (v1 gap: guards ignore `__accessUsers`)                           | ADR-006                                                                              |
| RLS on entity_types/workflows/workflow_states/workflow_transitions, `tenant-purge.ts` state deletion | ADR-007                                                                              |
| `api_keys` (audit, expiry, rotation, scopes)                                                         | ADR-008                                                                              |
| Connector runtime, webhook gateway, outbound delivery (3A)                                           | ADR-009, `.claude/context/phase-3-primer.md`                                         |
| Public / partner-facing API (Tier 1 only)                                                            | ADR-010                                                                              |
| `packages/plugin-sdk`, plugin install/uninstall                                                      | ADR-011 (known gaps: #644)                                                           |
| Third-party ticket API (Phases A–G)                                                                  | ADR-012, `docs/third-party-api-design.md` (index), `docs/specs/third-party-api-*.md` |
| Rate limiting (`packages/redis/src/rate-limit.ts`, api middleware, auth middleware)                  | ADR-013                                                                              |
| `apps/worker/src/notification-*.ts`, `alert-worker.ts`                                               | ADR-014                                                                              |
| `packages/telemetry`, retention/erasure sweeps                                                       | ADR-015                                                                              |
| Production TLS/HSTS, storage and backup encryption, production OpenBao                               | `docs/deployment-hardening.md`, `docs/local-setup.md`                                |
| Teams/services, on-call schedules, severity + labels, `resolve_oncall`, notification policies (3E)   | ADR-016, `docs/oncall-routing-design.md`                                             |
| `schedule_rules` / `schedule_executions`, scheduler tick (3F)                                        | ADR-017, `docs/temporal-scheduler-design.md`                                         |
| Reporting: `analytics_user` grants, Superset connection mutator, guest tokens, reporting audit (3G)  | ADR-019 (Proposed), ADR-001                                                          |
| `packages/automation-engine`                                                                         | `.claude/context/automation-engine.md` (always `/security-review`)                   |
| Helpdesk/reimbursements/CRM modules, platform services, admin-ui generic views, no-code builders     | `.claude/context/phase-2-primer.md`                                                  |
| AI features, `packages/ai`, model calls (3C — not started)                                           | ADR-018 (Proposed; accepting it does not start 3C)                                   |
| New modules, module ownership / placement (3H)                                                       | ADR-020 (Proposed), ADR-004, ADR-005                                                 |
| Ticket relations, child tickets, `__accessUsers` grants, access requests                             | ADR-021 (Proposed), ADR-006                                                          |
| Platform admin, multi-org sandboxes (provision, reset, delete, handover)                             | ADR-022 (Proposed), `docs/specs/multi-org-sandbox.md`                                |
| `packages/secrets`, OpenBao (startup loader, Transit, AppRole), production secrets delivery          | ADR-023 (Proposed), ADR-009, `docs/deployment-hardening.md`                          |
| Org directory (`packages/org-directory`, org chart, sync)                                            | `docs/specs/org-directory.md`                                                        |
| On-call teams with ordered members, recurring rosters, rotation worker                               | ADR-016 addendum, `docs/specs/oncall-team-rotation.md`                               |
| Parallel approval                                                                                    | Off-limits — `.claude/context/parallel-approval-pattern.md`, #65                     |
