import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth, requireRole } from "@platform/auth";
import { db } from "@platform/db";
import { listAutomationRules } from "@platform/automation-engine";
import type { TriggerType } from "@platform/automation-engine";
import { factory } from "./factory.js";
import { handleAutomationError } from "../../lib/handle-automation-error.js";

const TRIGGER_TYPES = [
  "workflow.entered_state",
  "workflow.transitioned",
  "workflow.sla_breached",
  "field.changed",
  "entity.created",
  "entity.assigned",
  "schedule.cron",
  "connector.event",
] as const;

const ListAutomationRulesQuerySchema = z.object({
  triggerType: z.enum(TRIGGER_TYPES).optional(),
  enabled: z.enum(["true", "false"]).optional(),
});

export const listAutomationRulesHandler = factory.createHandlers(
  requireAuth(),
  requireRole("admin"),
  zValidator("query", ListAutomationRulesQuerySchema),
  async (c) => {
    const { tenantId } = c.get("auth");
    const { triggerType, enabled } = c.req.valid("query");
    const isEnabled =
      enabled === "true" ? true : enabled === "false" ? false : undefined;

    try {
      const rules = await listAutomationRules(db, tenantId, {
        ...(triggerType !== undefined && {
          triggerType: triggerType as TriggerType,
        }),
        ...(isEnabled !== undefined && { isEnabled }),
      });
      return c.json({ data: rules });
    } catch (err) {
      return handleAutomationError(c, err);
    }
  },
);
