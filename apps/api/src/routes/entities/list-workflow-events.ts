import { requireAuth } from "@platform/auth";
import { withTenantContext } from "@platform/db";
import { getWorkflowEventLog } from "@platform/workflow-engine";
import { factory } from "./factory.js";
import { handleWorkflowError } from "../../lib/handle-workflow-error.js";

export const listWorkflowEventsHandler = factory.createHandlers(
  requireAuth(),
  async (c) => {
    const id = c.req.param("id") ?? "";
    const { tenantId } = c.get("auth");

    try {
      const events = await withTenantContext(tenantId, (tx) =>
        getWorkflowEventLog(tx, tenantId, id),
      );

      return c.json({ data: events });
    } catch (err) {
      return handleWorkflowError(c, err);
    }
  },
);
