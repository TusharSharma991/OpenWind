import { zValidator } from "../../lib/validator.js";
import { z } from "zod";
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

const CreateLinkSchema = z.object({
  title: z.string().trim().min(1).max(200),
  // A reference list, not a link-checker — accept any http(s) URL string,
  // never fetched/validated as reachable server-side.
  url: z.string().trim().url().max(2000),
});

export const createLinkHandler = factory.createHandlers(
  requireAuth(),
  requireRole("admin", "agent", "user"),
  zValidator("json", CreateLinkSchema),
  async (c) => {
    const id = c.req.param("id") ?? "";
    const { tenantId, userId, roles } = c.get("auth");
    const { title, url } = c.req.valid("json");
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
            fields: entityInstances.fields,
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

      // Same write-access rule as attachments (create-attachment.ts): admin/
      // agent, the record's own creator/assignee, an explicit read_write ACL
      // grant, or that ticket's workflow admin.
      if (!isPrivileged) {
        const accessUsers =
          (instance.fields as Record<string, unknown>).__accessUsers ?? {};
        const userAccess = (accessUsers as Record<string, { level: string }>)[
          userId
        ];
        let canWrite =
          instance.createdBy === userId ||
          instance.assignedTo === userId ||
          userAccess?.level === "read_write";

        if (!canWrite && instance.workflowId) {
          const workflow = await withTenantContext(tenantId, (tx) =>
            getWorkflow(tx, tenantId, instance.workflowId as string, {
              userId,
              isGlobalAdmin: false,
            }),
          );
          canWrite = isWorkflowAdmin(userId, workflow);
        }

        if (!canWrite) {
          return c.json(
            { error: "NOT_FOUND", message: "Record not found" },
            404,
          );
        }
      }

      const [link] = await withTenantContext(tenantId, (tx) =>
        tx
          .insert(entityLinks)
          .values({ tenantId, entityId: id, title, url, createdBy: userId })
          .returning({
            id: entityLinks.id,
            title: entityLinks.title,
            url: entityLinks.url,
            createdBy: entityLinks.createdBy,
            createdAt: entityLinks.createdAt,
          }),
      );

      // Emit a reference_link_added history event (best-effort — skip if no
      // workflowId), same fallback-to-parent pattern as create-attachment.ts.
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

      if (workflowId && link) {
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
              type: "reference_link_added",
              linkId: link.id,
              title: link.title,
              url: link.url,
            },
          }),
        );
      }

      return c.json({ data: link }, 201);
    } catch (err) {
      return handleEntityError(c, err);
    }
  },
);
