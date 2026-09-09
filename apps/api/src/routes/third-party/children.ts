import { z } from "zod";
import { eq, and, isNull } from "drizzle-orm";
import { requireAuth, requireActingPerson } from "@platform/auth";
import {
  withTenantContext,
  db,
  entityInstances,
  workflowEvents,
  outboxEvents,
} from "@platform/db";
import { createChildRelation, EntityError } from "@platform/entity-engine";
import { isWorkflowAdminOnly } from "@platform/workflow-engine";
import { zValidator } from "../../lib/validator.js";
import { factory } from "./factory.js";
import { requireTicketScope } from "./require-ticket-scope.js";
import { hasEntityAccess } from "../../lib/entity-access.js";
import { handleEntityError } from "../../lib/handle-entity-error.js";
import {
  validateFieldsPayload,
  FORBIDDEN_CHAR_PATTERN,
} from "./validate-fields-payload.js";
import { notFound } from "./not-found.js";
import { withIdempotency } from "../../lib/idempotency.js";
import { writeAuditEntry } from "@platform/audit";
import { logger } from "@platform/logger";
import { applicationActorIdFromUserId } from "../../lib/application-actor-id.js";
import { resolveOriginOidcClientId } from "../../lib/resolve-origin-oidc-client-id.js";
import { resolveOrgMemberUserId } from "../../lib/resolve-org-member.js";
import { postSystemComment } from "../../lib/post-system-comment.js";
import { redactEntityFieldsForThirdParty } from "../../lib/redact-entity-fields.js";
import { stripInternalFields } from "../../lib/strip-internal-fields.js";

// Mandatory-baseline-fields policy (2026-09-07) -- see tickets.ts's own
// CreateThirdPartyTicketSchema comment for the full rationale. Sub-tickets
// follow the identical rule: assignedTo/dueDate/remark are required, no
// exceptions, same as any top-level ticket.
const CreateThirdPartyChildSchema = z.object({
  entityTypeId: z.string().uuid(),
  fields: z.record(z.unknown()).default({}),
  // Control-character guard required here too (security review, 2026-09-08):
  // an unresolved assignedTo is now echoed verbatim into a system-generated
  // comment's text -- the same sink remark's own guard protects.
  assignedTo: z
    .string()
    .min(1)
    .refine((v) => !FORBIDDEN_CHAR_PATTERN.test(v), {
      message: "assignedTo contains a null byte or control character",
    }),
  dueDate: z.string().datetime(),
  // Same control-character guard as tickets.ts's identical field -- remark
  // is inserted as the sub-ticket's first comment, landing in the same
  // workflow_events.metadata.text sink comments.ts's own `text` guards
  // (found in security review, 2026-09-08).
  remark: z
    .string()
    .max(4000)
    .refine((v) => !FORBIDDEN_CHAR_PATTERN.test(v), {
      message: "remark contains a null byte or control character",
    }),
  // No state/currentState field, same rationale as Phase B's ticket-create
  // schema (spec R6 pattern) — a sub-ticket is always created into its own
  // "open" child_status, never a caller-supplied value.
});

/**
 * POST /api/v1/tickets/:id/children — ADR-012 Phase C, spec R9.
 *
 * Access to the *parent* ticket is gated the same way ticket detail is
 * (hasEntityAccess — any recognized access level, not the stricter
 * comment-only tier comments.ts uses, since creating a sub-ticket is closer
 * to "I can see/work this ticket" than "I can specifically comment on it").
 * Always 404 on denial, same convention as the rest of this API.
 *
 * 1-level nesting cap (spec R9): if the target parent is itself already a
 * child (ancestorDepth >= 1) — regardless of whether that parent was created
 * via this API or the UI — a further child cannot be created through this
 * endpoint. This is an API-specific restriction layered on top of
 * createChildRelation's own general CHILD_DEPTH_EXCEEDED check (which is
 * keyed off the workflow's own, possibly deeper, max_child_depth setting).
 * Enforced via createChildRelation's maxAncestorDepth param, checked under
 * the same row lock as everything else it validates — a separate, unlocked
 * pre-check here would race against a concurrent moveChildRelation call
 * that reparents the target between this check and the actual create.
 */
export const createThirdPartyChildHandler = factory.createHandlers(
  requireAuth(db),
  requireActingPerson(),
  requireTicketScope("subticket"),
  zValidator("json", CreateThirdPartyChildSchema),
  async (c) => {
    const parentId = c.req.param("id") ?? "";
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

    // docs/specs/third-party-api-origin-tagging.md R4/§V -- sub-tickets follow
    // the exact same tagging rules as top-level tickets (see tickets.ts's
    // identical check for the full rationale).
    const originOidcClientId = await resolveOriginOidcClientId(
      tenantId,
      applicationActorId,
    );
    if (!originOidcClientId) {
      return c.json({ error: "UNAUTHORIZED", message: "Invalid API key" }, 401);
    }

    // deletedAt filtered out here (unlike a plain existence check) so a
    // soft-deleted parent 404s at this route the same way getEntity already
    // does for the sibling GET route — otherwise it would pass this access
    // check, then fail inside createChildRelation's own re-fetch with a
    // differently-shaped error, reopening the existence-oracle leak the
    // design doc's Round 2 finding required closed.
    const [parent] = await withTenantContext(tenantId, (tx) =>
      tx
        .select({
          id: entityInstances.id,
          workflowId: entityInstances.workflowId,
          currentState: entityInstances.currentState,
          assignedTo: entityInstances.assignedTo,
          createdBy: entityInstances.createdBy,
          fields: entityInstances.fields,
        })
        .from(entityInstances)
        .where(
          and(
            eq(entityInstances.id, parentId),
            eq(entityInstances.tenantId, tenantId),
            isNull(entityInstances.deletedAt),
          ),
        )
        .limit(1),
    );

    if (!parent) {
      return notFound(c);
    }

    // Admin-only workflows are hidden from every third-party caller, no
    // exceptions -- see workflows.adminOnly's doc comment. This route
    // doesn't otherwise go through getWorkflow (unlike tickets.ts/
    // list-tickets.ts), so it needs this explicit check.
    if (parent.workflowId) {
      const adminOnly = await withTenantContext(tenantId, (tx) =>
        isWorkflowAdminOnly(tx, tenantId, parent.workflowId as string),
      );
      if (adminOnly) {
        return notFound(c);
      }
    }

    const allowed = await withTenantContext(tenantId, (tx) =>
      hasEntityAccess(tx, tenantId, parent, actingPersonId, []),
    );
    if (!allowed) {
      // Best-effort: nothing has mutated yet on this path, so a failure here
      // must never turn a correct 404 denial into a 500 -- same pattern as
      // transitions.ts's denied-branch audit write.
      try {
        await withTenantContext(tenantId, (tx) =>
          writeAuditEntry(tx, {
            tenantId,
            actorId: applicationActorId,
            actorType: "api_key",
            actingPersonId,
            resourceType: "ticket",
            resourceId: parentId,
            action: "child.access_denied",
          }),
        );
      } catch (auditErr) {
        logger.warn(
          { auditErr, tenantId, parentId },
          "third-party sub-ticket create: denied-attempt audit write failed",
        );
      }
      return notFound(c);
    }

    // assignedTo resolution -- same rationale/behavior as tickets.ts's
    // identical check (accepts either a raw user id or a username). Runs
    // only after the parent-access check above (moved here in security
    // review, 2026-09-08) so this org-lookup -- and the accepted
    // real-org-member oracle it exposes -- can't be probed via a
    // nonexistent or inaccessible parent ticket id.
    //
    // Policy (2026-09-08, revised from an earlier 422-on-failure design):
    // an unresolvable assignedTo no longer blocks sub-ticket creation --
    // see tickets.ts's identical comment for the full rationale (this was a
    // deliberate reversal of the same-day 422 design once the security
    // review flagged it as a fast, scriptable existence oracle). The
    // sub-ticket is always created (unassigned if resolution failed), and
    // the failure is reported only via a system comment notification below.
    const assignedToResolution = await resolveOrgMemberUserId(
      orgId,
      actingPersonToken,
      input.assignedTo,
    );
    const resolvedAssignedTo = assignedToResolution.ok
      ? assignedToResolution.userId
      : undefined;

    const response = await withIdempotency(
      {
        tenantId,
        applicationActorId,
        actingPersonId,
        idempotencyKey,
      },
      {
        parentId,
        entityTypeId: input.entityTypeId,
        fields: input.fields,
        assignedTo: resolvedAssignedTo,
        dueDate: input.dueDate,
        remark: input.remark,
      },
      async () => {
        try {
          const result = await withTenantContext(tenantId, async (tx) => {
            const created = await createChildRelation(tx, tenantId, {
              parentId,
              entityTypeId: input.entityTypeId,
              childFields: input.fields,
              assignedTo: resolvedAssignedTo,
              dueDate: input.dueDate,
              remark: input.remark,
              createdBy: actingPersonId,
              actorType: "api_key",
              actingPersonId,
              maxAncestorDepth: 1,
              originMechanism: "api",
              originOidcClientId,
              originPerformerUserId: actingPersonId,
            });
            await writeAuditEntry(tx, {
              tenantId,
              actorId: applicationActorId,
              actorType: "api_key",
              actingPersonId,
              resourceType: "ticket",
              resourceId: created.instance.id,
              action: "child.created",
              metadata: { parentId },
            });

            // Matches entities/create.ts's and tickets.ts's own
            // remark-as-first-comment behavior -- see tickets.ts's identical
            // block for the full rationale. Best-effort: a failure here must
            // never fail sub-ticket creation itself.
            const remark = input.remark.trim();
            let remarkCommentEventId: string | undefined;
            if (remark && created.instance.workflowId) {
              try {
                const [commentEvent] = await tx
                  .insert(workflowEvents)
                  .values({
                    tenantId,
                    instanceId: created.instance.id,
                    workflowId: created.instance.workflowId,
                    fromState: created.instance.currentState,
                    toState: created.instance.currentState,
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
                      instanceId: created.instance.id,
                      actorId: actingPersonId,
                      commentId: commentEvent.id,
                    },
                  });
                }
              } catch (remarkErr) {
                logger.error(
                  { remarkErr, tenantId, instanceId: created.instance.id },
                  "third-party sub-ticket create: failed to post remark as first comment",
                );
              }
            }

            // See resolveOrgMemberUserId call above and post-system-comment.ts
            // -- notify the creator that assignedTo didn't resolve via a
            // system comment, never via the API response itself.
            // Best-effort: must never fail sub-ticket creation itself.
            if (!assignedToResolution.ok && created.instance.workflowId) {
              try {
                await postSystemComment(tx, {
                  tenantId,
                  instanceId: created.instance.id,
                  workflowId: created.instance.workflowId,
                  currentState: created.instance.currentState,
                  text: `assignedTo "${input.assignedTo}" could not be resolved to an org member -- this sub-ticket was created unassigned.`,
                  replyToEventId: remarkCommentEventId,
                  notifyUserId: actingPersonId,
                });
              } catch (systemCommentErr) {
                logger.error(
                  {
                    systemCommentErr,
                    tenantId,
                    instanceId: created.instance.id,
                  },
                  "third-party sub-ticket create: failed to post assignedTo-unresolved system comment",
                );
              }
            }

            // ADR-012 Phase G, spec R7 -- same redact-then-strip pass the
            // GET routes apply, so a create response is never a second,
            // unfiltered path to the same ticket data (pii/financial values,
            // and the internal __accessUsers ACL object createChildRelation
            // always seeds from the parent's grants + assignee).
            const redactedFields = await redactEntityFieldsForThirdParty(
              tx,
              tenantId,
              created.instance.entityTypeId,
              created.instance.fields,
            );
            return {
              ...created,
              instance: {
                ...created.instance,
                fields: stripInternalFields(redactedFields),
              },
            };
          });
          return { status: 201, body: { data: result.instance } };
        } catch (err) {
          if (
            err instanceof EntityError &&
            err.code === "CHILD_DEPTH_EXCEEDED" &&
            err.meta?.reason === "caller_max_ancestor_depth"
          ) {
            return {
              status: 400,
              body: {
                error: "SUBTICKET_NESTING_EXCEEDED",
                message:
                  "An API-created sub-ticket cannot itself have a sub-ticket created via this API",
              },
            };
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
