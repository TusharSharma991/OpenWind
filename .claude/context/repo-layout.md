# Repository layout and dependency rule

Moved out of `CLAUDE.md` to keep that file short.

## Layout

```
apps/
  api/            Hono API server
  worker/         BullMQ workers (outbox, automations, SLA, schedule tick, notifications, AV scan)
  admin-ui/       Refine + shadcn/ui — the single UI for agents, admins and customers (RBAC);
                  apps/portal is only a workspace stub (source removed in PR #211)
packages/
  db/             Drizzle schema, migrations, client
  entity-engine/  workflow-engine/  automation-engine/
  auth/           Zitadel JWT + RBAC helpers
  notifications/  Novu wrapper
  files/          Tenant-scoped local-disk storage + async ClamAV scan (PR #340; async exports moved to local storage in #787)
  audit/          Append-only audit log
  config/         Zod-validated env — import from @platform/config
  logger/         Structured pino logger
  redis/          Shared ioredis client + rate-limit helper
  secrets/        OpenBao client
  connector-sdk/  plugin-sdk/   Phase 3 extension SDKs
  ui/             Shared design system (shadcn/ui + tokens)
  ai/             Anthropic SDK wrapper + RAG helpers
  teams/          Teams/services/on-call primitives, team members, rotation rules + shared cross-tenant FK helper (3E/3F)
  org-directory/  Org chart from Zitadel metadata: importer, tree build, sync, query API
  scheduler/      Cron + next-fire, timezone/template validation, cross-tenant ref checks (3F)
  telemetry/      OTel, Prometheus metrics, PII-scrubbed Sentry (3D)
  tsconfig/       Shared TypeScript base configs
modules/          Seed SQL + one-line stub index.ts per module
tests/            integration/ · isolation/ (tenant RLS, every db/ PR) · e2e/
```

## Dependency rule (ESLint-enforced; `pnpm dep:check` checks the transitive graph)

```
apps/*             → packages/*
modules/*          → packages/*   (no cross-module imports ever)
entity-engine      → db only
workflow-engine    → db, entity-engine
automation-engine  → db, workflow-engine, entity-engine, teams, audit
teams              → db only
scheduler          → db, teams, config, logger   (no package-specific boundary rule yet)
```

Cross-module communication goes through the event bus, the entity-engine relations API, or tRPC
only. To check what depends on a file, run `pnpm dep:impact -- '<path-regex>'`. A stale `dist/`
makes it under-report, so treat an empty result as inconclusive and cross-check with grep (see
`.claude/context/dependency-graph.md`).
