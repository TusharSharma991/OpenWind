# CLAUDE.md — Platform Engineering Context

Loaded every session. Rules in `.claude/rules/` auto-load (`code-style`, `agent-behaviour`,
`git-conventions` always; `db-conventions`, `testing-conventions`, `security` when you touch
matching paths).

---

## What we are building

A modular, workflow-native business platform. Every module (CRM, helpdesk, HRMS,
reimbursements, etc.) is a configuration of three shared engines: Entity Engine, Workflow Engine
and Automation Engine. Modules are seed SQL plus a one-line stub `index.ts`, with no domain-logic
TypeScript in `modules/` (ADR-004). Full architecture: `docs/architecture-brief.md`.

## Read before touching

**Before changing code in an area, open
[.claude/context/read-before-touching.md](.claude/context/read-before-touching.md)** — it maps each
area (tenancy/RLS, workflow, entity engine, `modules/`, api_keys, connectors, on-call, scheduler,
reporting, sandboxes, secrets, org directory, …) to its ADR or spec. Parallel approval is
off-limits (#65).

Status and history: `docs/tracker/roadmap-tracker.md` and `docs/tracker/week-log/`, one file per
session. The frozen pre-2026-08-14 log is `week-log/archive/week-log.md`; never edit it. Specs are
indexed in `docs/specs/README.md`.

`docs/sup-docs/` is **gitignored and local-only** (the owner's strategy, pricing and GTM notes).
Never assume a contributor can see it, never cite it from a tracked doc, and never put tracking
content in it.

---

## Current focus

**Phase 3 — Scale & Extensibility.** Phase 1 ✅ 2026-05-21, Phase 2 ✅ 2026-06-18. PR/issue detail
and live % live **only** in [roadmap-tracker.md](docs/tracker/roadmap-tracker.md). Edit this table
only when a track's headline changes (started / done / blocked).

| ID    | Track                                                           | Headline                                                                                                      |
| ----- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 3A    | Integration layer — connector runtime, partner API, marketplace | 🟡 Runtime + partner API (ADR-012 A–G) shipped; connectors #368 + marketplace UI #369 not started             |
| 3B    | Plugin system — Module Federation, slot registry                | ✅ Done (#397); 2 known gaps tracked in #644                                                                  |
| 3C    | AI layer — automation gen, workflow suggestion, RAG             | 🔴 Not started, no ADR — human scope call (#18, #614–618)                                                     |
| 3D    | Observability + compliance — OTel, Prometheus, GDPR             | ✅ Done (#503–507, ADR-015)                                                                                   |
| 3E    | On-call routing & severity-based notification                   | 🟡 Phases 1–4 merged (ADR-016); gaps: SMS/WhatsApp/voice delivery, duration metrics, 2 UI badges (#570, #571) |
| 3F    | Temporal scheduler — auto-create tickets on schedule            | 🟡 Phases 1–4 merged (ADR-017); gap: schedule alert rules (#580)                                              |
| 3G    | MIS reporting — embedded Superset + standalone/Zitadel SSO      | 🟡 Stages 1–2 merged (#663–671); ADR-019 proposed (#707); Stage 2 stays off pending review                    |
| 3H    | Cross-functional workflow visibility                            | 🟡 Phase 1 merged — vendor-approval seed module (#680); live walk-through #691; ADR-020 in review (#702)      |
| 3-OPS | Deferred ops/infra concerns                                     | 🔴 Not started (#6)                                                                                           |

Also active outside this table, with no track ID (see "Spec-driven efforts outside the track table" in
the tracker): the multi-org sandbox ([spec](docs/specs/multi-org-sandbox.md), ADR-022 Proposed) and
org-directory (shipped 2026-09-30 to 10-01, [spec](docs/specs/org-directory.md)).

No phase or track starts without explicit human sign-off. New review findings go through
[docs/reviews/pending-review-findings.md](docs/reviews/pending-review-findings.md); file an issue
before picking one up.

**Delivery:** every change runs Plan → Code → Review → Docs → Ship, guided by hooks documented
once in [.claude/README.md](.claude/README.md). The completion contract is
[definition-of-done.md](.claude/references/definition-of-done.md). The hooks are guardrails, not a
security boundary; CI plus human PR review is the real gate.

**Off-limits (never touch autonomously):** parallel approval code (#65) · ADR files in
`docs/decisions/` (humans write them) · schema cache / `redis.keys()` fix (deferred to load
testing, #4).

---

## Layout and dependency rule

`apps/*` (api, worker, admin-ui) → `packages/*`; `modules/*` → `packages/*` only, never another
module. Cross-module communication goes through the event bus, the entity-engine relations API or
tRPC. `pnpm dep:check` enforces the graph. The full layout, per-package boundary rules and
`pnpm dep:impact` usage are in
[.claude/context/repo-layout.md](.claude/context/repo-layout.md).

---

## Commands

Everything is containerized: `docker compose up -d` is the standard way to run the app, in dev and
on servers (Zitadel is a separate compose project, `../zitadel/`). `pnpm dev` is host-mode hot
reload for tight loops only. Optional profiles, macOS and Windows notes, and full setup are in
`docs/local-setup.md`.

```bash
docker compose up -d                          # default stack
pnpm typecheck && pnpm lint && pnpm test && pnpm test:isolation   # exit condition
pnpm test:e2e         # end-to-end API tests (needs the stack)
pnpm db:migrate       # run pending migrations
pnpm db:seed          # seed development data
```

---

## When stuck

1. Read the relevant ADR, then the existing tests — they document expected behavior precisely.
2. Check `.claude/context/` for the engine guide.
3. Check `docs/tracker/roadmap-tracker.md` before changing scope.
4. If a decision isn't covered by an ADR, stop and write it up in BLOCKERS.md. ADRs are
   human-authored, so a human writes the ADR before you implement.

**Dep bumps:** every security override pin lives in `pnpm-workspace.yaml` `overrides:` (pnpm v11
ignores `package.json`'s `pnpm.overrides`), with its advisory and rationale as an inline comment
plus a "Deferred" block. Never remove a pin without reading its comment. Record new advisories
there, not here.
