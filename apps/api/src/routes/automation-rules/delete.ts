import { requireAuth, requireRole } from "@platform/auth";
import { db } from "@platform/db";
import { deleteAutomationRule } from "@platform/automation-engine";
import { factory } from "./factory.js";
import { handleAutomationError } from "../../lib/handle-automation-error.js";

export const deleteAutomationRuleHandler = factory.createHandlers(
  requireAuth(),
  requireRole("admin"),
  async (c) => {
    const id = c.req.param("id") ?? "";
    const { tenantId } = c.get("auth");
    try {
      await deleteAutomationRule(db, tenantId, id);
      return new Response(null, { status: 204 });
    } catch (err) {
      return handleAutomationError(c, err);
    }
  },
);
