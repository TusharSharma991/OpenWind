import { requireAuth, requireRole } from "@platform/auth";
import { db } from "@platform/db";
import { listAutomationRules } from "@platform/automation-engine";
import type { TriggerType } from "@platform/automation-engine";
import { factory } from "./factory.js";
import { handleAutomationError } from "../../lib/handle-automation-error.js";

export const listAutomationRulesHandler = factory.createHandlers(
  requireAuth(),
  requireRole("admin"),
  async (c) => {
    const { tenantId } = c.get("auth");
    const triggerType = c.req.query("triggerType") as TriggerType | undefined;
    const enabledParam = c.req.query("enabled");
    const isEnabled =
      enabledParam === "true"
        ? true
        : enabledParam === "false"
          ? false
          : undefined;

    try {
      const rules = await listAutomationRules(db, tenantId, {
        ...(triggerType !== undefined && { triggerType }),
        ...(isEnabled !== undefined && { isEnabled }),
      });
      return c.json({ data: rules });
    } catch (err) {
      return handleAutomationError(c, err);
    }
  },
);
