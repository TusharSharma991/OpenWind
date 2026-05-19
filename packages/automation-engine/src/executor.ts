import { eq, and } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { DbOrTx } from "@platform/db";
import { automationRules, automationExecutions } from "@platform/db";
import { logger } from "@platform/logger";
import { evaluateConditionTree } from "@platform/workflow-engine";
import type { ConditionTree } from "@platform/workflow-engine";
import { TriggerEventSchema } from "./event-schemas.js";
import type { TriggerEvent } from "./event-schemas.js";
import { AutomationError } from "./types.js";
import type { ActionConfig } from "./types.js";
import { executeNotifyAction } from "./actions/notify.js";
import { executeSetFieldAction } from "./actions/set-field.js";
import { executeTransitionAction } from "./actions/transition.js";
import { isOpen, recordFailure, reset } from "./circuit-breaker.js";

const MAX_DEPTH = 10;

export async function executeAutomationRules(
  db: DbOrTx,
  tenantId: string,
  rawEvent: unknown,
  depth = 0,
  redis?: Redis,
): Promise<void> {
  if (depth >= MAX_DEPTH) {
    throw new AutomationError("MAX_DEPTH_EXCEEDED", { depth });
  }

  const parsed = TriggerEventSchema.safeParse(rawEvent);
  if (!parsed.success) {
    throw new AutomationError("INVALID_EVENT_PAYLOAD", {
      errors: parsed.error.issues,
    });
  }
  const event: TriggerEvent = parsed.data;

  const rules = await db
    .select()
    .from(automationRules)
    .where(
      and(
        eq(automationRules.tenantId, tenantId),
        eq(automationRules.triggerType, event.eventType),
        eq(automationRules.isEnabled, true),
      ),
    )
    .orderBy(automationRules.priority, automationRules.createdAt);

  for (const rule of rules) {
    const fields =
      "fields" in event ? (event.fields as Record<string, unknown>) : {};
    const passes = evaluateConditionTree(
      rule.conditions as ConditionTree | null,
      fields,
    );
    if (!passes) continue;

    const [execRow] = await db
      .insert(automationExecutions)
      .values({
        tenantId,
        ruleId: rule.id,
        triggerEvent: event as Record<string, unknown>,
        status: "running",
        startedAt: new Date(),
      })
      .returning();

    if (!execRow) continue;

    try {
      for (const action of rule.actions as ActionConfig[]) {
        await runAction(db, tenantId, event, action, depth, redis);
      }

      await db
        .update(automationExecutions)
        .set({ status: "success", completedAt: new Date() })
        .where(eq(automationExecutions.id, execRow.id));

      logger.info(
        { tenantId, ruleId: rule.id, execId: execRow.id },
        "Automation: rule executed successfully",
      );
    } catch (err) {
      await db
        .update(automationExecutions)
        .set({
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
          completedAt: new Date(),
        })
        .where(eq(automationExecutions.id, execRow.id));

      logger.error(
        { tenantId, ruleId: rule.id, execId: execRow.id, err },
        "Automation: rule execution failed",
      );
    }
  }
}

async function runAction(
  db: DbOrTx,
  tenantId: string,
  event: TriggerEvent,
  action: ActionConfig,
  depth: number,
  redis?: Redis,
): Promise<void> {
  const config = action.config;

  if (redis && (await isOpen(redis, tenantId, action.type))) {
    logger.warn(
      { tenantId, actionType: action.type },
      "Automation: circuit open — skipping action",
    );
    return;
  }

  try {
    switch (action.type) {
      case "notify":
        await executeNotifyAction(
          db,
          tenantId,
          event,
          config as Parameters<typeof executeNotifyAction>[3],
        );
        break;
      case "set_field":
        await executeSetFieldAction(
          db,
          tenantId,
          event,
          config as unknown as Parameters<typeof executeSetFieldAction>[3],
        );
        break;
      case "transition":
        await executeTransitionAction(
          db,
          tenantId,
          event,
          config as unknown as Parameters<typeof executeTransitionAction>[3],
          depth,
        );
        break;
      default:
        logger.warn(
          { tenantId, actionType: action.type },
          "Automation: unhandled action type",
        );
        return;
    }
    if (redis) await reset(redis, tenantId, action.type);
  } catch (err) {
    if (redis) await recordFailure(redis, tenantId, action.type);
    throw err;
  }
}
