import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth, requireRole } from "@platform/auth";
import { db } from "@platform/db";
import { createAutomationRule } from "@platform/automation-engine";
import type { TriggerType, ActionConfig } from "@platform/automation-engine";
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

const CreateAutomationRuleSchema = z.object({
  name: z.string().min(1).max(200),
  triggerType: z.enum(TRIGGER_TYPES),
  triggerConfig: z.record(z.unknown()),
  conditions: z.unknown().optional(),
  actions: z.array(ActionConfigSchema).min(1),
  isEnabled: z.boolean().optional(),
  priority: z.number().int().optional(),
});

export const createAutomationRuleHandler = factory.createHandlers(
  requireAuth(),
  requireRole("admin"),
  zValidator("json", CreateAutomationRuleSchema),
  async (c) => {
    const { tenantId } = c.get("auth");
    const input = c.req.valid("json");
    try {
      const rule = await createAutomationRule(db, tenantId, {
        ...input,
        triggerType: input.triggerType as TriggerType,
        actions: input.actions as ActionConfig[],
      });
      return c.json({ data: rule }, 201);
    } catch (err) {
      return handleAutomationError(c, err);
    }
  },
);
