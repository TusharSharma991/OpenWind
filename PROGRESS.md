## 2026-06-24 — external review reconciliation + pre-phase-3 setup

### Done

- Received and reconciled three-lens external review (CTO, Product, UX) dated 2026-06-23
- Corrected stale docs: CLAUDE.md, VISION.md, db-conventions.md, platform-vision.md, roadmap-tracker.md, week-log.md, phase-2-primer.md, automation-engine.md, security.md, git-conventions.md (PR #119, merged)
- Created GH issues #120–#129 for all 10 pre-Phase 3 hardening items
- Backfilled issue links into CLAUDE.md hardening checklist

### Verification

- pnpm typecheck: not run (docs-only changes)
- pnpm lint: not run (docs-only changes)
- pnpm test: not run (docs-only changes)
- pnpm test:isolation: not run (docs-only changes)

### Next

**Before any Phase 3 work starts, the hardening sprint must complete.**
All 10 items are tracked — run `gh issue list --state open --label phase:2` to see current status.

Priority order from external review:

1. #121 — RLS role fix (`withTenantContext` + `SET LOCAL ROLE app_user`)
2. #122 — un-skip isolation tests and run as `app_user` in CI
3. #120 — automation double-trigger / depth-reset fix
4. #123 — automation queue retries
5. #124 — auth middleware `onConflictDoNothing`
6. #125 — wire `notify` action to Novu
7. #126 — emit `entity.created` / `entity.assigned` to outbox
8. #127 — guard `setEntityState` / `bulkSetState`
9. #128 — uncomment OpenBao + MinIO in docker-compose.yml
10. #129 — worker health endpoint

**After hardening sprint:** Phase 3 planning sign-off required before starting 3A.
Write `.claude/context/phase-3-primer.md` before the first 3A session.

### Open questions

- None currently. Phase 3 track sequencing (3A → 3B → 3C, 3D parallel) is documented in CLAUDE.md.
