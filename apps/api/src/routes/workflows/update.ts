import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth, requireRole } from "@platform/auth";
import { withTenantContext } from "@platform/db";
import { updateWorkflow } from "@platform/workflow-engine";
import { factory } from "./factory.js";
import { handleWorkflowError } from "../../lib/handle-workflow-error.js";

const UpdateWorkflowSchema = z.object({
  isActive: z.boolean().optional(),
  assignedTo: z.array(z.string()).optional(),
  maxChildDepth: z.number().int().min(0).max(10).nullable().optional(),
  maxChildrenPerParent: z.number().int().min(1).max(100).nullable().optional(),
});

export const updateWorkflowHandler = factory.createHandlers(
  requireAuth(),
  requireRole("admin"),
  zValidator("json", UpdateWorkflowSchema),
  async (c) => {
    const id = c.req.param("id") ?? "";
    const { tenantId } = c.get("auth");
    const input = c.req.valid("json");

    try {
      const workflow = await withTenantContext(tenantId, (tx) =>
        updateWorkflow(tx, tenantId, id, input),
      );
      return c.json({ data: workflow });
    } catch (err) {
      return handleWorkflowError(c, err);
    }
  },
);
