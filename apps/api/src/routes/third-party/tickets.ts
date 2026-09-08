import { z } from "zod";
import { requireAuth, requireActingPerson } from "@platform/auth";
import {
  withTenantContext,
  db,
  workflowEvents,
  outboxEvents,
} from "@platform/db";
import { getEntity, createEntity } from "@platform/entity-engine";
import { getWorkflow } from "@platform/workflow-engine";
import { zValidator } from "../../lib/validator.js";
import { factory } from "./factory.js";
import { requireTicketScope } from "./require-ticket-scope.js";
import { hasEntityAccess } from "../../lib/entity-access.js";
import { handleEntityError } from "../../lib/handle-entity-error.js";
import {
  validateFieldsPayload,
  FORBIDDEN_CHAR_PATTERN,
} from "./validate-fields-payload.js";
import {
  referenceAttachments,
  AttachmentReferenceError,
  MAX_ATTACHMENTS_PER_TICKET,
} from "./attachments-reference.js";
import { notFound } from "./not-found.js";
import { redactEntityFieldsForThirdParty } from "../../lib/redact-entity-fields.js";
import { stripInternalFields } from "../../lib/strip-internal-fields.js";
import { withIdempotency } from "../../lib/idempotency.js";
import { applicationActorIdFromUserId } from "../../lib/application-actor-id.js";
import { resolveOriginOidcClientId } from "../../lib/resolve-origin-oidc-client-id.js";
import { resolveOrgMemberUserId } from "../../lib/resolve-org-member.js";
import { postSystemComment } from "../../lib/post-system-comment.js";
import { writeAuditEntry } from "@platform/audit";
import { logger } from "@platform/logger";

function isEntityNotFound(err: unknown): boolean {
  return (
    err instanceof Error &&
    err.name === "EntityError" &&
    (err as Error & { code?: string }).code === "ENTITY_NOT_FOUND"
  );
}

/**
 * GET /api/v1/tickets/:id — ADR-012 Phase B, spec R7.
 *
 * Access-list gated via the same shared hasEntityAccess helper the UI's own
 * entity-detail route (entities/get.ts) uses — not a re-implemented inline
 * check. Always 404 on denial, INCLUDING a cross-tenant ticket ID: getEntity
 * already applies an explicit `tenant_id = ?` filter (defense-in-depth
 * alongside entity_instances' own RLS), so a cross-tenant row throws the
 * exact same ENTITY_NOT_FOUND a genuinely nonexistent ID would — no separate
 * cross-tenant branch exists to add here, matching the platform's standard
 * 404-not-403 convention (security.md).
 *
 * The acting person has no internal RBAC role in this system (they never log
 * into OpenWind — that's the whole point of the third-party API) — passing
 * an empty roles array means hasEntityAccess's admin/agent bypass never
 * fires, and access reduces purely to the ACL fields (creator/assignee/
 * __accessUsers) or workflow-admin status, exactly the access-list model
 * the design doc's interview section specifies for this identity.
 */
export const getThirdPartyTicketHandler = factory.createHandlers(
  requireAuth(db),
  requireActingPerson(),
  requireTicketScope("read"),
  async (c) => {
    const id = c.req.param("id") ?? "";
    const { tenantId, userId: authUserId } = c.get("auth");
    const { userId } = c.get("actingPerson");
    const applicationActorId = applicationActorIdFromUserId(authUserId);

    try {
      const instance = await withTenantContext(tenantId, (tx) =>
        getEntity(tx, tenantId, id),
      );

      const allowed = await withTenantContext(tenantId, (tx) =>
        hasEntityAccess(tx, tenantId, instance, userId, []),
      );
      if (!allowed) {
        // Best-effort: an audit-write failure must never turn a correct 404
        // denial into a 500 -- same pattern as transitions.ts's denied
        // branch.
        try {
          await withTenantContext(tenantId, (tx) =>
            writeAuditEntry(tx, {
              tenantId,
              actorId: applicationActorId,
              actorType: "api_key",
              actingPersonId: userId,
              resourceType: "ticket",
              resourceId: id,
              action: "ticket.view_denied",
            }),
          );
        } catch (auditErr) {
          logger.warn(
            { auditErr, tenantId, instanceId: id },
            "third-party ticket view: denied-attempt audit write failed",
          );
        }
        return notFound(c);
      }

      // ADR-012 Phase G, spec R7 — redact pii/financial field values before
      // this ever leaves the process; a third party never sees a raw,
      // unredacted dump of ticket fields.
      const redactedFields = await withTenantContext(tenantId, (tx) =>
        redactEntityFieldsForThirdParty(
          tx,
          tenantId,
          instance.entityTypeId,
          instance.fields,
        ),
      );

      // Best-effort, same rationale as the denied branch above -- a logging
      // hiccup must never turn a successful read into a 500.
      try {
        await withTenantContext(tenantId, (tx) =>
          writeAuditEntry(tx, {
            tenantId,
            actorId: applicationActorId,
            actorType: "api_key",
            actingPersonId: userId,
            resourceType: "ticket",
            resourceId: id,
            action: "ticket.viewed",
          }),
        );
      } catch (auditErr) {
        logger.warn(
          { auditErr, tenantId, instanceId: id },
          "third-party ticket view: allowed-attempt audit write failed",
        );
      }

      return c.json({
        data: {
          ...instance,
          fields: stripInternalFields(redactedFields),
        },
      });
    } catch (err) {
      if (isEntityNotFound(err)) {
        return notFound(c);
      }
      throw err;
    }
  },
);

// Mandatory-baseline-fields policy (2026-09-07): title (an entity_fields row,
// already required on every real workflow), assignedTo, dueDate, and remark
// are required on every ticket, on every workflow, no exceptions -- this is a
// platform-wide invariant, not a per-workflow toggle (unlike a workflow's own
// custom entity_fields, which remain individually configurable). Previously
// assignedTo/dueDate/remark were either optional or entirely absent from this
// schema, so the only place this was ever enforced was admin-ui's own
// client-side form check (record-create.tsx) -- trivially bypassed by any
// direct API call, including this one. This is a breaking change to the
// documented third-party API contract (third-party-api-reference.md) --
// every existing integration must now send all three.
const CreateThirdPartyTicketSchema = z.object({
  workflowId: z.string().uuid(),
  fields: z.record(z.unknown()).default({}),
  // Control-character guard required here too (security review, 2026-09-08):
  // an unresolved assignedTo is now echoed verbatim into a system-generated
  // comment's text (postSystemComment, see the assignedTo-resolution block
  // below) -- the exact same workflow_events.metadata.text sink remark's
  // own guard protects.
  assignedTo: z
    .string()
    .min(1)
    .refine((v) => !FORBIDDEN_CHAR_PATTERN.test(v), {
      message: "assignedTo contains a null byte or control character",
    }),
  dueDate: z.string().datetime(),
  // remark is inserted verbatim as the ticket's first comment (see the
  // remark-as-comment block below), landing in the exact same
  // workflow_events.metadata.text sink comments.ts's own `text` field
  // writes into -- same control-character guard required here so this
  // create path can't reintroduce what that route's ingress check exists
  // to block (found in security review, 2026-09-08).
  remark: z
    .string()
    .max(4000)
    .refine((v) => !FORBIDDEN_CHAR_PATTERN.test(v), {
      message: "remark contains a null byte or control character",
    }),
  // Any `state`/`currentState` field the caller sends is intentionally NOT
  // part of this schema — Zod's default "strip unknown keys" behavior drops
  // it silently, with no rejection (spec R6: force-to-initial-state
  // unconditionally, confirmed decision, no error path for this case).
  // ADR-012 Phase D, spec R3 -- references completed attachment uploads
  // presigned without a ticketId (the create-time-attach case).
  attachmentIds: z
    .array(z.string().uuid())
    .max(MAX_ATTACHMENTS_PER_TICKET)
    .default([]),
});

/**
 * POST /api/v1/tickets — ADR-012 Phase B, spec R6/R8/R9/R11/R13/R14.
 *
 * Always creates into the workflow's initial state: createEntity is never
 * given a `currentState`, so it falls into entity-engine's own
 * resolve-initial-state branch (packages/entity-engine/src/engine.ts) —
 * there is no separate "force to initial" flag to maintain, and no way for
 * a caller-supplied state to reach the engine at all.
 *
 * Creator identity: actorType is explicitly "api_key" (not inferred as
 * "user" the way the human-UI route's createdBy-based heuristic would),
 * and actingPersonId carries the real person distinctly — resolves the
 * ambiguity flagged since the very first gap analysis (#3) and Round 7's
 * GAP-05. createdBy itself is also stamped with the acting person's id, so
 * the created record's own creator field shows the real person, not the
 * key.
 */
export const createThirdPartyTicketHandler = factory.createHandlers(
  requireAuth(db),
  requireActingPerson(),
  requireTicketScope("create"),
  zValidator("json", CreateThirdPartyTicketSchema),
  async (c) => {
    const { tenantId, orgId, userId: authUserId } = c.get("auth");
    const { userId: actingPersonId } = c.get("actingPerson");
    const input = c.req.valid("json");
    const applicationActorId = applicationActorIdFromUserId(authUserId);
    const idempotencyKey = c.req.header("Idempotency-Key");
    const actingPersonToken = c.req.header("X-Acting-Person-Token") ?? "";

    const fieldsCheck = validateFieldsPayload(input.fields);
    if (!fieldsCheck.ok) {
      return c.json(
        {
          error: "VALIDATION_ERROR",
          message: "Validation failed",
          fields: { fields: fieldsCheck.reason },
        },
        422,
      );
    }

    // docs/specs/third-party-api-origin-tagging.md §V -- every API-originated
    // ticket ALWAYS has a resolvable app+performer identity, never created
    // untagged. The key just authenticated this request (requireAuth already
    // ran), so a null here means it was revoked/deleted in the moment
    // between auth and this line -- treat as unauthorized, not a 500, since
    // the caller's credential is what actually became invalid.
    const originOidcClientId = await resolveOriginOidcClientId(
      tenantId,
      applicationActorId,
    );
    if (!originOidcClientId) {
      return c.json({ error: "UNAUTHORIZED", message: "Invalid API key" }, 401);
    }

    // assignedTo resolution -- accepts either the caller's raw AuthNexus
    // user id or their username (loginName), since a caller integrating
    // against this API is far more likely to have a person's username on
    // hand than their opaque numeric id. Previously this field was stored
    // verbatim with zero validation, so a username silently landed in
    // assigned_to and never matched any real user in the UI's own lookup
    // (which keys strictly on userId) -- the ticket just looked unassigned,
    // with no error anywhere (found via manual testing against a real
    // client org).
    //
    // Policy (2026-09-08, revised from an earlier 422-on-failure design):
    // an unresolvable assignedTo no longer blocks ticket creation. The
    // ticket is always created (unassigned if resolution failed), and the
    // caller learns about the failure only via a system-generated comment
    // notification (posted below, after the remark comment), never via a
    // synchronous 422 -- see post-system-comment.ts for the full rationale
    // (this was a deliberate, discussed reversal of the original 422
    // design, which the same day's security review had already flagged as
    // exposing a fast, scriptable "does this identifier exist" oracle).
    const assignedToResolution = await resolveOrgMemberUserId(
      orgId,
      actingPersonToken,
      input.assignedTo,
    );
    const resolvedAssignedTo = assignedToResolution.ok
      ? assignedToResolution.userId
      : undefined;

    // ADR-012 Phase G, spec R3/R4/R5 -- idempotency wraps only the actual
    // mutating operation, not upstream validation, so a caller retrying a
    // request that already 422'd above re-validates fresh rather than
    // replaying a cached failure forever under the same key.
    const response = await withIdempotency(
      {
        tenantId,
        applicationActorId,
        actingPersonId,
        idempotencyKey,
      },
      {
        workflowId: input.workflowId,
        fields: input.fields,
        assignedTo: resolvedAssignedTo,
        dueDate: input.dueDate,
        remark: input.remark,
        attachmentIds: input.attachmentIds,
      },
      async () => {
        try {
          const instance = await withTenantContext(tenantId, async (tx) => {
            const workflow = await getWorkflow(tx, tenantId, input.workflowId, {
              userId: actingPersonId,
              isGlobalAdmin: false,
            });
            const created = await createEntity(tx, tenantId, {
              entityTypeId: workflow.entityTypeId,
              workflowId: workflow.id,
              fields: input.fields,
              assignedTo: resolvedAssignedTo,
              dueDate: input.dueDate,
              remark: input.remark,
              createdBy: actingPersonId,
              actorId: applicationActorId,
              actorType: "api_key",
              actingPersonId,
              originMechanism: "api",
              originOidcClientId,
              originPerformerUserId: actingPersonId,
            });
            // Same transaction as the create above -- a rejected attachment
            // reference rolls back the whole ticket creation, never leaving a
            // ticket with a dangling bad attachmentId (spec R3).
            await referenceAttachments(
              tx,
              tenantId,
              created.id,
              input.attachmentIds,
              actingPersonId,
              applicationActorId,
            );

            // Matches entities/create.ts's own remark-as-first-comment
            // behavior (the human-UI create form presents remark as "this
            // becomes the first comment") -- previously this route stored
            // remark only on the instance's own column, never posting it to
            // the Comments tab/timeline, so an API-created ticket's remark
            // was invisible everywhere a human-created ticket's wasn't
            // (found via manual testing). Best-effort: a failure here must
            // never fail ticket creation itself, which has already
            // committed by this point.
            const remark = input.remark.trim();
            let remarkCommentEventId: string | undefined;
            if (remark) {
              try {
                const [commentEvent] = await tx
                  .insert(workflowEvents)
                  .values({
                    tenantId,
                    instanceId: created.id,
                    workflowId: workflow.id,
                    fromState: created.currentState,
                    toState: created.currentState,
                    triggeredBy: "api_key",
                    actorId: actingPersonId,
                    comment: null,
                    metadata: {
                      type: "comment",
                      text: remark,
                      actorType: "api_key",
                      actingPersonId,
                    },
                    originMechanism: "api",
                    originOidcClientId,
                    originPerformerUserId: actingPersonId,
                  })
                  .returning();
                if (commentEvent) {
                  remarkCommentEventId = commentEvent.id;
                  await tx.insert(outboxEvents).values({
                    tenantId,
                    eventType: "comment.created",
                    version: 1,
                    payload: {
                      eventType: "comment.created",
                      version: 1,
                      tenantId,
                      instanceId: created.id,
                      actorId: actingPersonId,
                      commentId: commentEvent.id,
                    },
                  });
                }
              } catch (remarkErr) {
                logger.error(
                  { remarkErr, tenantId, instanceId: created.id },
                  "third-party ticket create: failed to post remark as first comment",
                );
              }
            }

            // See resolveOrgMemberUserId call above and post-system-comment.ts
            // -- notify the creator that assignedTo didn't resolve via a
            // system comment (reply to the remark comment when one exists,
            // otherwise a top-level comment), never via the API response
            // itself. Best-effort: must never fail ticket creation, which
            // has already committed by this point.
            if (!assignedToResolution.ok) {
              try {
                await postSystemComment(tx, {
                  tenantId,
                  instanceId: created.id,
                  workflowId: workflow.id,
                  currentState: created.currentState,
                  text: `assignedTo "${input.assignedTo}" could not be resolved to an org member -- this ticket was created unassigned.`,
                  replyToEventId: remarkCommentEventId,
                  notifyUserId: actingPersonId,
                });
              } catch (systemCommentErr) {
                logger.error(
                  { systemCommentErr, tenantId, instanceId: created.id },
                  "third-party ticket create: failed to post assignedTo-unresolved system comment",
                );
              }
            }

            // ADR-012 Phase G, spec R7 -- same redact-then-strip pass every
            // read endpoint applies, so a create response (which echoes the
            // stored entity straight back) is never a second, unfiltered
            // path to pii/financial values or the internal __accessUsers
            // ACL object.
            const redactedFields = await redactEntityFieldsForThirdParty(
              tx,
              tenantId,
              created.entityTypeId,
              created.fields,
            );
            return {
              ...created,
              fields: stripInternalFields(redactedFields),
            };
          });

          return { status: 201, body: { data: instance } };
        } catch (err) {
          if (err instanceof AttachmentReferenceError) {
            return { status: err.status, body: err.body };
          }
          const errResponse = handleEntityError(c, err);
          return {
            status: errResponse.status,
            body: (await errResponse.json()) as unknown,
          };
        }
      },
    );

    return c.json(response.body as object, response.status as never);
  },
);
