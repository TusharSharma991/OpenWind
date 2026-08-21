import { zValidator } from "../../lib/validator.js";
import { z } from "zod";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { requireAuth, requireRole } from "@platform/auth";
import {
  files,
  outboxEvents,
  tenantUsers,
  workflowEvents,
  withTenantContext,
} from "@platform/db";
import { createEntity } from "@platform/entity-engine";
import { logger } from "@platform/logger";
import { factory } from "./factory.js";
import { handleEntityError } from "../../lib/handle-entity-error.js";
import { listUserIdsWithRole } from "../../lib/authnexus-management.js";
import { ensureUserRefsKnown } from "../../lib/ensure-user-refs.js";

const CreateEntitySchema = z.object({
  entityTypeId: z.string().uuid(),
  fields: z.record(z.unknown()),
  assignedTo: z.string().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  remark: z.string().max(4000).nullable().optional(),
  workflowId: z.string().uuid().optional(),
  currentState: z.string().optional(),
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A file/files-type custom field's value is uploaded before this entity
// exists, so it can only ever reach the API as a bare id string - never
// bound (files.entityId) to anything yet. Rather than looking up the entity
// type's field definitions to find which fields are file-typed, just collect
// every UUID-shaped string value (top-level or inside an array) as a
// candidate; the DB-side WHERE guards below (unbound + same tenant + same
// uploader) mean a false positive - some unrelated field that merely happens
// to hold a UUID-shaped string - simply matches no file row and is a no-op.
function collectFileIdCandidates(fields: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const v of Object.values(fields)) {
    if (typeof v === "string" && UUID_RE.test(v)) out.push(v);
    else if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === "string" && UUID_RE.test(item)) out.push(item);
      }
    }
  }
  return out;
}

export const createEntityHandler = factory.createHandlers(
  requireAuth(),
  requireRole("admin", "agent", "user"),
  zValidator("json", CreateEntitySchema),
  async (c) => {
    const { tenantId, userId, orgId } = c.get("auth");
    const input = c.req.valid("json");
    const bearerToken = c.req.header("Authorization")?.slice(7) ?? "";

    // assignedTo must resolve to a real tenant member holding the "user" role —
    // the same pool GET /platform/users exposes. Role membership is AuthNexus-side
    // (tenant_users has no role column), scoped by orgId, so this also rejects a
    // cross-tenant user id (they simply won't appear in this org's role set).
    // Fail closed (no orgId → reject) rather than silently skipping the check.
    if (input.assignedTo !== undefined) {
      const usersWithRole = orgId
        ? await listUserIdsWithRole(orgId, "user", bearerToken)
        : new Set<string>();
      if (!usersWithRole.has(input.assignedTo)) {
        return c.json(
          {
            error: "VALIDATION_ERROR",
            message: "Validation failed",
            fields: {
              assignedTo:
                "Must be an existing tenant member with the 'user' role",
            },
          },
          422,
        );
      }
    }

    try {
      const [dbUser] = await withTenantContext(tenantId, (tx) =>
        tx
          .select({
            displayName: tenantUsers.displayName,
            email: tenantUsers.email,
          })
          .from(tenantUsers)
          .where(
            and(
              eq(tenantUsers.userId, userId),
              eq(tenantUsers.tenantId, tenantId),
            ),
          )
          .limit(1),
      );
      const actorName =
        dbUser?.displayName && dbUser.displayName !== userId
          ? dbUser.displayName
          : dbUser?.email && dbUser.email !== userId
            ? dbUser.email
            : null;

      const instance = await withTenantContext(tenantId, async (tx) => {
        // Upsert tenant_users for any user_ref field referencing a genuine
        // org member who hasn't logged into this app yet - otherwise
        // createEntity's own validateUserRefs (tenant_users-only) wrongly
        // rejects them. Must run inside this same transaction, before
        // createEntity, so its validation sees the freshly-inserted rows.
        await ensureUserRefsKnown(
          tx,
          tenantId,
          input.entityTypeId,
          input.fields,
          orgId,
          bearerToken,
        );
        return createEntity(tx, tenantId, {
          ...input,
          actorId: userId,
          actorName: actorName ?? undefined,
          createdBy: userId,
        });
      });

      // Link any file/files custom-field values uploaded before this entity
      // existed - otherwise GET /entities/:id/attachments (which filters on
      // files.entity_id) never finds them and the UI shows nothing for
      // those fields despite the entity's fields JSON holding valid ids.
      const fileIdCandidates = collectFileIdCandidates(input.fields);
      if (fileIdCandidates.length > 0) {
        await withTenantContext(tenantId, (tx) =>
          tx
            .update(files)
            .set({ entityId: instance.id })
            .where(
              and(
                inArray(files.id, fileIdCandidates),
                eq(files.tenantId, tenantId),
                eq(files.uploadedBy, userId),
                isNull(files.entityId),
              ),
            ),
        );
      }

      // The create form's Remark field is mandatory and is presented to the
      // user as "this becomes the first comment" — post it as a real comment
      // (workflow_events, type "comment") rather than only storing it on the
      // instance, so it actually shows up in the Comments tab/feed like any
      // other comment. Best-effort: a failure here must not fail ticket
      // creation itself, which has already committed by this point.
      const remark = input.remark?.trim();
      if (remark && instance.workflowId) {
        try {
          const [commentEvent] = await withTenantContext(tenantId, (tx) =>
            tx
              .insert(workflowEvents)
              .values({
                tenantId,
                instanceId: instance.id,
                workflowId: instance.workflowId as string,
                fromState: instance.currentState,
                toState: instance.currentState,
                triggeredBy: "user",
                actorId: userId,
                comment: null,
                metadata: {
                  type: "comment",
                  text: remark,
                  mentions: [],
                  replyTo: null,
                  actorName,
                },
              })
              .returning(),
          );

          if (commentEvent) {
            await withTenantContext(tenantId, (tx) =>
              tx.insert(outboxEvents).values({
                tenantId,
                eventType: "comment.created",
                version: 1,
                payload: {
                  eventType: "comment.created",
                  version: 1,
                  tenantId,
                  instanceId: instance.id,
                  actorId: userId,
                  commentId: commentEvent.id,
                },
              }),
            );
          }
        } catch (remarkErr) {
          logger.error(
            { remarkErr, tenantId, instanceId: instance.id },
            "create-entity: failed to post remark as first comment",
          );
        }
      }

      return c.json({ data: instance }, 201);
    } catch (err) {
      return handleEntityError(c, err);
    }
  },
);
