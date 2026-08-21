import { requireAuth, requireRole } from "@platform/auth";
import {
  entityInstances,
  entityLinks,
  entityRelations,
  workflowEvents,
  withTenantContext,
} from "@platform/db";
import { and, eq, isNull } from "drizzle-orm";
import { getWorkflow, isWorkflowAdmin } from "@platform/workflow-engine";
import { factory } from "./factory.js";
import { handleEntityError } from "../../lib/handle-entity-error.js";

export const deleteLinkHandler = factory.createHandlers(
  requireAuth(),
  requireRole("admin", "agent", "user"),
  async (c) => {
    const id = c.req.param("id") ?? "";
    const linkId = c.req.param("linkId") ?? "";
    const { tenantId, userId, roles } = c.get("auth");
    const isPrivileged = roles.includes("admin") || roles.includes("agent");

    try {
      const [instance] = await withTenantContext(tenantId, (tx) =>
        tx
          .select({
            id: entityInstances.id,
            workflowId: entityInstances.workflowId,
            currentState: entityInstances.currentState,
            createdBy: entityInstances.createdBy,
            assignedTo: entityInstances.assignedTo,
          })
          .from(entityInstances)
          .where(
            and(
              eq(entityInstances.id, id),
              eq(entityInstances.tenantId, tenantId),
            ),
          )
          .limit(1),
      );

      if (!instance) {
        return c.json({ error: "NOT_FOUND", message: "Record not found" }, 404);
      }

      const [link] = await withTenantContext(tenantId, (tx) =>
        tx
          .select()
          .from(entityLinks)
          .where(
            and(eq(entityLinks.id, linkId), eq(entityLinks.tenantId, tenantId)),
          )
          .limit(1),
      );

      if (link?.entityId !== id) {
        return c.json({ error: "NOT_FOUND", message: "Link not found" }, 404);
      }

      // Who can remove a link: the person who added it, the ticket's own
      // creator or assignee (even if they didn't add this particular link),
      // admin/agent, or an admin of this ticket's workflow. Broader than
      // "only the adder" deliberately — a ticket's owner should be able to
      // clean up stale reference links regardless of who dropped them in.
      const isTicketOwner =
        instance.createdBy === userId || instance.assignedTo === userId;
      if (!isPrivileged && link.createdBy !== userId && !isTicketOwner) {
        const canDelete = instance.workflowId
          ? isWorkflowAdmin(
              userId,
              await withTenantContext(tenantId, (tx) =>
                getWorkflow(tx, tenantId, instance.workflowId as string, {
                  userId,
                  isGlobalAdmin: false,
                }),
              ),
            )
          : false;
        if (!canDelete) {
          return c.json({ error: "NOT_FOUND", message: "Link not found" }, 404);
        }
      }

      await withTenantContext(tenantId, (tx) =>
        tx
          .delete(entityLinks)
          .where(
            and(eq(entityLinks.id, linkId), eq(entityLinks.tenantId, tenantId)),
          ),
      );

      // Emit a reference_link_removed history event (best-effort — skip if
      // no workflowId), same fallback-to-parent pattern as
      // delete-attachment.ts.
      let workflowId = instance.workflowId;
      if (!workflowId) {
        const [parentRel] = await withTenantContext(tenantId, (tx) =>
          tx
            .select({ toInstanceId: entityRelations.toInstanceId })
            .from(entityRelations)
            .where(
              and(
                eq(entityRelations.fromInstanceId, id),
                eq(entityRelations.tenantId, tenantId),
                eq(entityRelations.relationType, "child_of"),
                isNull(entityRelations.deletedAt),
              ),
            )
            .limit(1),
        );
        if (parentRel) {
          const [parent] = await withTenantContext(tenantId, (tx) =>
            tx
              .select({ workflowId: entityInstances.workflowId })
              .from(entityInstances)
              .where(
                and(
                  eq(entityInstances.id, parentRel.toInstanceId),
                  eq(entityInstances.tenantId, tenantId),
                ),
              )
              .limit(1),
          );
          workflowId = parent?.workflowId ?? null;
        }
      }

      if (workflowId) {
        await withTenantContext(tenantId, (tx) =>
          tx.insert(workflowEvents).values({
            tenantId,
            instanceId: id,
            workflowId,
            fromState: instance.currentState,
            toState: instance.currentState,
            triggeredBy: "user",
            actorId: userId,
            comment: null,
            metadata: {
              type: "reference_link_removed",
              linkId: link.id,
              title: link.title,
              url: link.url,
            },
          }),
        );
      }

      return c.body(null, 204);
    } catch (err) {
      return handleEntityError(c, err);
    }
  },
);
