# 2026-09-08 — third-party API: System Agent reply replaces the 422-on-unresolved oracle

Follow-up to the same day's earlier baseline-fields/mention-validation work. That work shipped
a synchronous 422 ("not found") whenever `assignedTo` or a comment `mentions[]` entry failed to
resolve to a real org member. On reflection (prompted by external feedback), that 422 is itself
a fast, scriptable "does this org member exist" oracle — an attacker with a valid API key could
enumerate usernames by checking the synchronous HTTP status code, at whatever rate the platform's
existing rate limits allow (up to 600 req/min per tenant, 20 mentions per comment).

## The fix: uniform response + async notification, never a synchronous answer

- `assignedTo`/`mentions[]` resolution failures no longer 422. The ticket/comment is always
  created/accepted (assignedTo ends up `null` if unresolved; an unresolved mention just doesn't
  get its grant/notification wired, same as the pre-422 original design).
- Instead, a **"System Agent" comment** is posted that **replies** to an existing comment
  authored by the person who submitted the bad value (the remark comment on ticket/child create,
  or the third-party comment carrying the bad mention). This rides the platform's _existing_
  `comment.replied` notification path — the one already used for real user-to-user replies —
  which notifies only that one comment's author. When no host comment exists (e.g. an empty
  `remark`), it falls back to a top-level comment + the existing `comment.mentioned` path
  instead, targeting the same person.
- Net effect: the "not found" signal is now delivered only to the one person who submitted the
  identifier, through a real in-app/email notification, and never through the synchronous API
  response. This doesn't erase the signal (the submitter still learns "found" vs "not found" for
  their own guess) — it moves the signal from a free, instant, scriptable channel to one that
  costs a real ticket comment and a real notification per guess, and leaves a visible trail in
  the ticket's own history.

## New files/mechanism

- `apps/api/src/lib/post-system-comment.ts` (new) — shared helper for `tickets.ts`/`children.ts`.
- `apps/worker/src/mention-resolution-worker.ts`'s pre-existing "outcome 3" (unresolvable/
  non-tenant-user mention) branch now posts the same kind of reply, inline (can't share the
  apps/api helper across the apps/\* dependency boundary).
- System-authored comments use a fixed sentinel `actorId: "system"` / `metadata.actorName:
"System Agent"` — never a real user id, renders correctly in the timeline via the existing
  `metadata.actorName` "snapshot name" mechanism (skips the normal org-member display-name
  lookup entirely).

## Security review follow-up (same day)

One finding from a scoped `security-reviewer` pass, fixed before commit: `assignedTo` and each
`mentions[]` entry lacked the control-character guard already applied to `remark`/comment
`text`, despite now being echoed verbatim into the identical `workflow_events.metadata.text`
sink via the new system-reply comments. Fixed by extending the shared `FORBIDDEN_CHAR_PATTERN`
refine to both fields.

The review also explicitly checked (and ruled out) whether this redesign reopens the oracle
through a different door — e.g. a caller polling a GET endpoint for the system reply's
appearance instead of relying on the (now-uniform) create/comment response. There is currently
no third-party endpoint that lists comments/timeline events, so this isn't possible today; if
one is ever added to the third-party API surface, this needs re-review.

## Known, accepted gap

System-generated comments don't get their own `writeAuditEntry` row (a normal user comment
insert does). Minor repudiation gap, not blocking — noted here for whoever eventually adds
audit coverage for system-authored actions generally.

## Not yet ported

This redesign has not yet been ported to the `tushar` git tree, which received the earlier
(pre-reply-design) assignedTo-resolution + mention-validation port on 2026-09-08 in commit
`5c982ba3` on `fix/select-enum-and-origin-rls`. That port still has the 422-on-failure behavior
this diff reverses; it should be updated to match once this design is confirmed stable here.
