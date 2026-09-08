# 2026-09-08 — system-comment origin mislabel fix + collapsible OriginTag UI

Found via live testing against the real production instance (jmv.work.rokkalabs.com), scoped
to the IT Assets Request test workflow only.

## Bug: system-generated comments mislabeled as "External · <app>"

`postSystemComment` (and, separately, `mention-resolution-worker.ts`'s outcome-3 branch) set
`originMechanism: "api"` / `originOidcClientId: <the caller's own app client id>` on the
System Agent reply comment — copied from the request context that triggered it. This made
admin-ui's `OriginTag` render the internally-generated message as `External · tenderIntelligence
· system`, wrongly attributing it to the third-party application whose request happened to
surface the failure, rather than showing it as what it actually is: a plain internal system
message.

Fixed: `postSystemComment` no longer accepts or sets `originOidcClientId`/`originMechanism` at
all — a null/absent origin renders with no tag (per
`docs/specs/third-party-api-origin-tagging.md` §V, "null origin means normal, in-app creation").
Also simplified the actor label from `"System Agent"` to plain `"system"`, matching the fixed
`actorId: "system"` sentinel.

## UI: OriginTag now collapses by default

The inline `External · [App] · [Person]` badge (`OriginTag`, used in the comment feed and
activity timeline) got visually noisy with several third-party-sourced entries in one feed.
Now collapses to just the mechanism label (`External`/`Redirected`) by default, expanding to
the full `· [App] · [Person]` detail on click (a real `<button>` now, not a plain `<span>`) —
the title tooltip still carries full detail on hover without needing a click.

## Verification

- `pnpm --filter @platform/api typecheck/lint`, `pnpm --filter @platform/worker typecheck/lint`,
  `pnpm --filter @platform/admin-ui typecheck/lint`: all clean
- `third-party-ticket-create.isolation.test.ts` / `third-party-subticket-create.isolation.test.ts`:
  32 tests, green (assertions updated from `"System Agent"` to `"system"`)
- `mention-resolution-worker.test.ts`: 16 tests, green (same assertion update)
- `origin-tag.test.tsx`: 14 tests, green (5 rewritten/added for the collapse/expand behavior)

## Outstanding

A live prod test also surfaced a second issue not yet resolved: an unresolvable comment
`mentions[]` entry (`"bobby"`) did not get a System Agent reply posted at all, unlike the
`assignedTo` case (which worked correctly, synchronously). The `assignedTo` path is synchronous
(inside the ticket-create request); the mention path is async (BullMQ job via
`mention-resolution-worker.ts`) — investigation is ongoing, pending worker logs from the
deployment (server access restricted this session per explicit instruction).
