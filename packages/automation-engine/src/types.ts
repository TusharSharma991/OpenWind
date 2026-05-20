import type { ConditionTree } from "@platform/workflow-engine";

export type TriggerType =
  | "workflow.entered_state"
  | "workflow.transitioned"
  | "workflow.sla_breached"
  | "field.changed"
  | "entity.created"
  | "entity.assigned"
  | "schedule.cron"
  | "connector.event";

export type ActionType =
  | "notify"
  | "assign"
  | "transition"
  | "set_field"
  | "create_entity"
  | "webhook"
  | "connector.action"
  | "script";

export interface AutomationRule {
  id: string;
  tenantId: string;
  name: string;
  isEnabled: boolean;
  triggerType: TriggerType;
  triggerConfig: Record<string, unknown>;
  conditions: ConditionTree | null;
  actions: ActionConfig[];
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ActionConfig {
  type: ActionType;
  config: Record<string, unknown>;
}

export type CreateAutomationRuleInput = {
  name: string;
  triggerType: TriggerType;
  triggerConfig: Record<string, unknown>;
  conditions?: ConditionTree | null | undefined;
  actions: ActionConfig[];
  isEnabled?: boolean | undefined;
  priority?: number | undefined;
};

export type UpdateAutomationRuleInput = {
  name?: string | undefined;
  isEnabled?: boolean | undefined;
  triggerType?: TriggerType | undefined;
  triggerConfig?: Record<string, unknown> | undefined;
  conditions?: ConditionTree | null | undefined;
  actions?: ActionConfig[] | undefined;
  priority?: number | undefined;
};

export class AutomationError extends Error {
  constructor(
    public readonly code:
      | "RULE_NOT_FOUND"
      | "RULE_CREATE_FAILED"
      | "MAX_DEPTH_EXCEEDED"
      | "ACTION_FAILED"
      | "INVALID_EVENT_PAYLOAD",
    public readonly meta?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "AutomationError";
  }
}
