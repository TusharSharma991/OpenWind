import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth, requireRole } from "@platform/auth";
import { db } from "@platform/db";
import { updateAutomationRule } from "@platform/automation-engine";
import type { TriggerType, ActionConfig } from "@platform/automation-engine";
import { factory } from "./factory.js";
import { handleAutomationError } from "../../lib/handle-automation-error.js";

const ActionConfigSchema = z.object({
  type: z.enum([
    "notify",
    "assign",
    "transition",
    "set_field",
    "create_entity",
    "webhook",
    "connector.action",
    "script",
  ]),
  config: z.record(z.unknown()),
});

const UpdateAutomationRuleSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    isEnabled: z.boolean().optional(),
    triggerType: z
      .enum([
        "workflow.entered_state",
        "workflow.transitioned",
        "workflow.sla_breached",
        "field.changed",
        "entity.created",
        "entity.assigned",
        "schedule.cron",
        "connector.event",
      ])
      .optional(),
    triggerConfig: z.record(z.unknown()).optional(),
    conditions: z.unknown().optional(),
    actions: z.array(ActionConfigSchema).min(1).optional(),
    priority: z.number().int().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field is required",
  });

export const updateAutomationRuleHandler = factory.createHandlers(
  requireAuth(),
  requireRole("admin"),
  zValidator("json", UpdateAutomationRuleSchema),
  async (c) => {
    const id = c.req.param("id") ?? "";
    const { tenantId } = c.get("auth");
    const input = c.req.valid("json");
    try {
      const rule = await updateAutomationRule(db, tenantId, id, {
        ...input,
        triggerType: input.triggerType as TriggerType | undefined,
        actions: input.actions as ActionConfig[] | undefined,
      });
      return c.json({ data: rule });
    } catch (err) {
      return handleAutomationError(c, err);
    }
  },
);
