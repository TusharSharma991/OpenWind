## 2026-06-24 — post-review followup (PR #130)

### Done

- Backfilled GH issue numbers (#120–#129) into CLAUDE.md hardening checklist
- Created PROGRESS.md (this file) as session handoff
- Fixed VISION.md "for pilot" wording duplication
- Fixed `docs/platform-vision.md` P1 chart style to green (S2)

_Prior session (PR #119, same date): reconciled stale docs with code reality after external review — CLAUDE.md, VISION.md, db-conventions.md, platform-vision.md, roadmap-tracker.md, week-log.md, phase-2-primer.md, automation-engine.md, security.md, git-conventions.md._

### Verification

- pnpm typecheck: N/A — docs-only
- pnpm lint: N/A — docs-only
- pnpm test: N/A — docs-only
- pnpm test:isolation: N/A — docs-only

### Next

**Hardening sprint — all 10 items must close before 3A starts.**
Run `gh issue list --state open --label phase:2` to see current queue.

Work in this order (top two are sequentially dependent):

1. [#121](../../issues/121) — RLS role fix (`withTenantContext` + `SET LOCAL ROLE app_user`)
2. [#122](../../issues/122) — un-skip isolation tests, run CI as `app_user` (depends on #121)
3. [#120](../../issues/120) — automation double-trigger / depth-reset
4. [#123](../../issues/123) — automation queue retries
5. [#124](../../issues/124) — auth middleware `onConflictDoNothing`
6. [#125](../../issues/125) — wire `notify` action to Novu
7. [#126](../../issues/126) — emit `entity.created` / `entity.assigned` to outbox
8. [#127](../../issues/127) — guard `setEntityState` / `bulkSetState`
9. [#128](../../issues/128) — uncomment OpenBao + MinIO in docker-compose.yml
10. [#129](../../issues/129) — worker health endpoint

**After hardening sprint:** Phase 3 planning sign-off required before starting 3A. Write `.claude/context/phase-3-primer.md` before the first 3A session (noted in CLAUDE.md Phase 3 tracks table).

### Open questions

- None. Phase 3 track sequencing (3A → 3B → 3C, 3D parallel) is documented in CLAUDE.md.
