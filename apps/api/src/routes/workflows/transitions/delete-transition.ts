import { requireAuth, requireRole } from "@platform/auth";
import { withTenantContext } from "@platform/db";
import { deleteWorkflowTransition } from "@platform/workflow-engine";
import { factory } from "../factory.js";
import { handleWorkflowError } from "../../../lib/handle-workflow-error.js";

export const deleteTransitionHandler = factory.createHandlers(
  requireAuth(),
  requireRole("admin"),
  async (c) => {
    const workflowId = c.req.param("id") ?? "";
    const transitionId = c.req.param("transitionId") ?? "";
    const { tenantId } = c.get("auth");
    try {
      await withTenantContext(tenantId, (tx) =>
        deleteWorkflowTransition(tx, tenantId, workflowId, transitionId),
      );
      return c.body(null, 204);
    } catch (err) {
      return handleWorkflowError(c, err);
    }
  },
);
