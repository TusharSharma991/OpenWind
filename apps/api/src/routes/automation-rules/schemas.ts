/**
 * Shared Zod schemas for automation-rule routes.
 * Single source of truth — imported by create.ts, update.ts, and list.ts.
 */
import { z } from "zod";
import type { ConditionTree } from "@platform/workflow-engine";

// ── Trigger types ─────────────────────────────────────────────────────────────

export const TRIGGER_TYPES = [
  "workflow.entered_state",
  "workflow.transitioned",
  "workflow.sla_breached",
  "field.changed",
  "entity.created",
  "entity.assigned",
  "schedule.cron",
  "connector.event",
] as const;

export const TriggerTypeSchema = z.enum(TRIGGER_TYPES);

// ── Action config ─────────────────────────────────────────────────────────────

export const ActionConfigSchema = z.object({
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

// ── Condition tree ────────────────────────────────────────────────────────────
// Mirrors ConditionTree from @platform/workflow-engine. Validated at write time
// so structural errors surface as 400s rather than silent executor failures.

const FieldConditionSchema = z.object({
  op: z.enum([
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "contains",
    "in",
    "empty",
    "not_empty",
  ]),
  field: z.string(),
  value: z.unknown().optional(),
});

export type ConditionTreeInput =
  | { op: "and"; children: ConditionTreeInput[] }
  | { op: "or"; children: ConditionTreeInput[] }
  | { op: "not"; child: ConditionTreeInput }
  | z.infer<typeof FieldConditionSchema>;

export const ConditionTreeSchema: z.ZodType<ConditionTreeInput> = z.lazy(() =>
  z.union([
    z.object({ op: z.literal("and"), children: z.array(ConditionTreeSchema) }),
    z.object({ op: z.literal("or"), children: z.array(ConditionTreeSchema) }),
    z.object({ op: z.literal("not"), child: ConditionTreeSchema }),
    FieldConditionSchema,
  ]),
);

// Bidirectional compile-time compatibility guards.
// _Forward: fails if workflow-engine adds a new operator that ConditionTreeSchema doesn't cover.
// _Inverse: fails if ConditionTreeInput drifts to accept shapes that ConditionTree rejects.
// Both must remain `true` — a `never` here is a tsc error.
export type _AssertConditionTreeCompatible =
  ConditionTreeInput extends ConditionTree ? true : never;
export type _AssertConditionTreeInverse =
  ConditionTree extends ConditionTreeInput ? true : never;
