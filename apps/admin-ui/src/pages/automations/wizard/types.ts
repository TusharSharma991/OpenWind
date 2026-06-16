// Shared types for the automation rule wizard

export type TriggerType =
  | "workflow.entered_state"
  | "workflow.transitioned"
  | "workflow.sla_breached"
  | "field.changed"
  | "entity.created"
  | "entity.assigned";

export type ConditionLeaf = {
  op:
    | "eq"
    | "neq"
    | "gt"
    | "gte"
    | "lt"
    | "lte"
    | "contains"
    | "in"
    | "empty"
    | "not_empty";
  field: string;
  value?: unknown;
};

export type ConditionGroup = {
  op: "and" | "or";
  children: ConditionNode[];
};

export type ConditionNode = ConditionLeaf | ConditionGroup;

export type ActionType = "notify" | "set_field" | "transition" | "webhook";

export type ActionItem = {
  id: string; // local only, for React keys
  type: ActionType;
  config: Record<string, unknown>;
};

export type WizardData = {
  triggerType: TriggerType | "";
  triggerConfig: Record<string, unknown>;
  conditions: ConditionGroup | null;
  actions: ActionItem[];
  name: string;
  priority: number;
  isEnabled: boolean;
};

export const EMPTY_WIZARD: WizardData = {
  triggerType: "",
  triggerConfig: {},
  conditions: null,
  actions: [],
  name: "",
  priority: 0,
  isEnabled: true,
};
