import type { DbOrTx } from "@platform/db";
import { executeTransition } from "@platform/workflow-engine";
import type { TriggerEvent } from "../event-schemas.js";
import { executeAutomationRules } from "../executor.js";

export interface TransitionConfig {
  instanceId?: string;
  transitionId: string;
  comment?: string;
}

export async function executeTransitionAction(
  db: DbOrTx,
  tenantId: string,
  event: TriggerEvent,
  config: TransitionConfig,
  depth: number,
): Promise<void> {
  const instanceId =
    config.instanceId ??
    ("instanceId" in event ? event.instanceId : undefined);
  if (!instanceId) return;

  const workflowEvent = await executeTransition(db, tenantId, {
    instanceId,
    transitionId: config.transitionId,
    triggeredBy: "automation",
    comment: config.comment,
  });

  // Recursively execute rules triggered by this transition (depth + 1 for guard)
  const followUpEvent = {
    version: 1 as const,
    eventType: "workflow.transitioned" as const,
    tenantId,
    instanceId,
    entityTypeId: workflowEvent.instanceId, // placeholder — full event from DB would be needed
    workflowId: workflowEvent.workflowId,
    fromState: workflowEvent.fromState,
    toState: workflowEvent.toState,
    triggeredBy: "automation" as const,
    actorId: null,
    occurredAt: workflowEvent.createdAt.toISOString(),
  };

  await executeAutomationRules(db, tenantId, followUpEvent, depth + 1);
}
