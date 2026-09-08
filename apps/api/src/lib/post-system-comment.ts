import type { DbOrTx } from "@platform/db";
import { workflowEvents, outboxEvents } from "@platform/db";

/**
 * Posts a system-generated comment (actor tag "system") notifying one
 * specific user that something they submitted via the third-party API (an
 * assignedTo value, a comment mention) could not be resolved to a real org
 * member.
 *
 * Design (2026-09-08, discussed and agreed): this exists specifically so the
 * API response itself never has to reveal whether an identifier resolved --
 * the request always succeeds (201, comment/ticket created as submitted),
 * and the *only* place the caller learns "that didn't resolve" is a
 * notification delivered to the one person who submitted it, through the
 * normal in-app/email channel a real reply or mention would use. This turns
 * a free, instant, scriptable oracle (a 422 in the HTTP response, checkable
 * thousands of times a minute) into one that costs a real comment on a real
 * ticket and a real notification per guess -- self-limiting and visible in
 * the ticket's own history, not silently probeable.
 *
 * `replyToEventId` should be the id of an existing comment authored by
 * `notifyUserId` (e.g. the remark-as-first-comment row, or the third-party
 * comment that carried the bad mention) -- the reply then rides the
 * existing `comment.replied` notification path (see add-comment.ts), which
 * notifies exactly that comment's own author. When no such comment exists
 * yet (e.g. an empty remark on ticket create), pass `replyToEventId:
 * undefined` and this posts a top-level comment instead, notifying
 * `notifyUserId` via the existing `comment.mentioned` path -- same
 * notification outcome, no reply target required.
 *
 * `actorId`/`triggeredBy` are the fixed sentinel `"system"` (never a real
 * user id), with `metadata.actorName: "system"` set so the comment timeline
 * renders a fixed label without attempting an org-member lookup
 * (list-workflow-events.ts uses `metadata.actorName` verbatim when present,
 * exactly the mechanism real users' snapshot names already rely on).
 *
 * Deliberately does NOT set originMechanism/originOidcClientId -- found via
 * live testing (2026-09-08): this comment is generated internally by the
 * platform itself, not by the third-party application whose request
 * happened to trigger it. Tagging it with that app's originOidcClientId
 * made admin-ui show it as "External · <app name>", wrongly attributing an
 * internal system message to the third-party caller. Leaving origin fields
 * unset renders it as a plain internal comment, same as any other
 * platform-generated event (see docs/specs/third-party-api-origin-tagging.md
 * §V: null origin means normal, in-app creation -- no tag rendered).
 */
export async function postSystemComment(
  tx: DbOrTx,
  params: {
    tenantId: string;
    instanceId: string;
    workflowId: string;
    currentState: string;
    text: string;
    replyToEventId?: string | undefined;
    notifyUserId: string;
  },
): Promise<void> {
  const {
    tenantId,
    instanceId,
    workflowId,
    currentState,
    text,
    replyToEventId,
    notifyUserId,
  } = params;

  const [event] = await tx
    .insert(workflowEvents)
    .values({
      tenantId,
      instanceId,
      workflowId,
      fromState: currentState,
      toState: currentState,
      triggeredBy: "system",
      actorId: "system",
      comment: null,
      metadata: {
        type: "comment",
        text,
        actorName: "system",
        ...(replyToEventId ? { replyTo: replyToEventId } : {}),
      },
    })
    .returning();
  if (!event) return;

  await tx.insert(outboxEvents).values({
    tenantId,
    eventType: "comment.created",
    version: 1,
    payload: {
      eventType: "comment.created",
      version: 1,
      tenantId,
      instanceId,
      actorId: "system",
      commentId: event.id,
    },
  });

  await tx.insert(outboxEvents).values(
    replyToEventId
      ? {
          tenantId,
          eventType: "comment.replied",
          version: 1,
          payload: {
            eventType: "comment.replied",
            version: 1,
            tenantId,
            instanceId,
            actorId: "system",
            targetUserId: notifyUserId,
          },
        }
      : {
          tenantId,
          eventType: "comment.mentioned",
          version: 1,
          payload: {
            eventType: "comment.mentioned",
            version: 1,
            tenantId,
            instanceId,
            actorId: "system",
            mentionedUserIds: [notifyUserId],
          },
        },
  );
}
