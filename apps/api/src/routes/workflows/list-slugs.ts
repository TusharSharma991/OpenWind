import { requireAuth, requireRole } from "@platform/auth";
import { withTenantContext } from "@platform/db";
import { listWorkflowSlugs } from "@platform/workflow-engine";
import { factory } from "./factory.js";
import { handleWorkflowError } from "../../lib/handle-workflow-error.js";
import { toWorkflowCaller } from "../../lib/workflow-caller.js";

// Deliberately not ownership-filtered — see listWorkflowSlugs' doc comment.
export const listWorkflowSlugsHandler = factory.createHandlers(
  requireAuth(),
  requireRole("admin", "agent", "user"),
  async (c) => {
    const auth = c.get("auth");
    const { tenantId } = auth;
    try {
      const rows = await withTenantContext(tenantId, (tx) =>
        listWorkflowSlugs(tx, tenantId, toWorkflowCaller(auth)),
      );
      return c.json({ data: rows });
    } catch (err) {
      return handleWorkflowError(c, err);
    }
  },
);
