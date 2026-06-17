import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth, requireRole } from "@platform/auth";
import { withTenantContext } from "@platform/db";
import { workflowStates, workflowTransitions } from "@platform/db";
import { and, eq, inArray } from "drizzle-orm";
import { getWorkflow } from "@platform/workflow-engine";
import { logger } from "@platform/logger";
import { factory } from "./factory.js";
import { handleWorkflowError } from "../../lib/handle-workflow-error.js";

const NEW_PREFIX = "__new_";

const CanvasStateSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  color: z.string().nullable().optional(),
  isTerminal: z.boolean().default(false),
  slaHours: z.number().int().positive().nullable().optional(),
  sortOrder: z.number().int().min(0).default(0),
});

const CanvasTransitionSchema = z.object({
  id: z.string(),
  fromState: z.string().min(1).max(100),
  toState: z.string().min(1).max(100),
  label: z.string().max(200).default(""),
  allowedRoles: z.array(z.string()).default([]),
  requiresComment: z.boolean().default(false),
  requiresFields: z.array(z.string()).default([]),
});

export const CanvasSaveSchema = z.object({
  states: z.array(CanvasStateSchema),
  transitions: z.array(CanvasTransitionSchema),
});

export const canvasSaveHandler = factory.createHandlers(
  requireAuth(),
  requireRole("admin"),
  zValidator("json", CanvasSaveSchema),
  async (c) => {
    const workflowId = c.req.param("id") ?? "";
    const input = c.req.valid("json");
    const { tenantId } = c.get("auth");

    try {
      const updated = await withTenantContext(tenantId, async (tx) => {
        const current = await getWorkflow(tx, tenantId, workflowId);

        const currentStateIds = new Set(current.states.map((s) => s.id));
        const currentTransitionIds = new Set(
          current.transitions.map((t) => t.id),
        );

        const newStates = input.states.filter((s) =>
          s.id.startsWith(NEW_PREFIX),
        );
        const existingStates = input.states.filter(
          (s) => !s.id.startsWith(NEW_PREFIX) && currentStateIds.has(s.id),
        );
        const incomingStateIds = new Set(
          input.states
            .filter((s) => !s.id.startsWith(NEW_PREFIX))
            .map((s) => s.id),
        );
        const deletedStates = current.states.filter(
          (s) => !incomingStateIds.has(s.id),
        );
        const deletedStateIds = deletedStates.map((s) => s.id);
        const deletedStateNames = new Set(deletedStates.map((s) => s.name));

        const newTransitions = input.transitions.filter((t) =>
          t.id.startsWith(NEW_PREFIX),
        );
        const existingTransitions = input.transitions.filter(
          (t) => !t.id.startsWith(NEW_PREFIX) && currentTransitionIds.has(t.id),
        );
        const incomingTransitionIds = new Set(
          input.transitions
            .filter((t) => !t.id.startsWith(NEW_PREFIX))
            .map((t) => t.id),
        );
        // Cascade-delete transitions referencing removed states
        const deletedTransitionIds = current.transitions
          .filter(
            (t) =>
              !incomingTransitionIds.has(t.id) ||
              deletedStateNames.has(t.fromState) ||
              deletedStateNames.has(t.toState),
          )
          .map((t) => t.id);

        if (deletedTransitionIds.length > 0) {
          await tx
            .delete(workflowTransitions)
            .where(
              and(
                eq(workflowTransitions.workflowId, workflowId),
                inArray(workflowTransitions.id, deletedTransitionIds),
              ),
            );
        }

        if (deletedStateIds.length > 0) {
          await tx
            .delete(workflowStates)
            .where(
              and(
                eq(workflowStates.workflowId, workflowId),
                inArray(workflowStates.id, deletedStateIds),
              ),
            );
        }

        if (newStates.length > 0) {
          await tx.insert(workflowStates).values(
            newStates.map((s) => ({
              workflowId,
              name: s.name,
              label: s.label,
              color: s.color ?? null,
              isTerminal: s.isTerminal,
              slaHours: s.slaHours ?? null,
              sortOrder: s.sortOrder,
            })),
          );
        }

        for (const s of existingStates) {
          await tx
            .update(workflowStates)
            .set({
              label: s.label,
              color: s.color ?? null,
              isTerminal: s.isTerminal,
              slaHours: s.slaHours ?? null,
              sortOrder: s.sortOrder,
            })
            .where(
              and(
                eq(workflowStates.id, s.id),
                eq(workflowStates.workflowId, workflowId),
              ),
            );
        }

        if (newTransitions.length > 0) {
          await tx.insert(workflowTransitions).values(
            newTransitions.map((t) => ({
              workflowId,
              fromState: t.fromState,
              toState: t.toState,
              label: t.label || null,
              allowedRoles: t.allowedRoles,
              conditions: null,
              requiresComment: t.requiresComment,
              requiresFields: t.requiresFields,
            })),
          );
        }

        for (const t of existingTransitions) {
          await tx
            .update(workflowTransitions)
            .set({
              label: t.label || null,
              allowedRoles: t.allowedRoles,
              requiresComment: t.requiresComment,
              requiresFields: t.requiresFields,
            })
            .where(
              and(
                eq(workflowTransitions.id, t.id),
                eq(workflowTransitions.workflowId, workflowId),
              ),
            );
        }

        logger.info(
          {
            tenantId,
            workflowId,
            addedStates: newStates.length,
            deletedStates: deletedStateIds.length,
            addedTransitions: newTransitions.length,
            deletedTransitions: deletedTransitionIds.length,
          },
          "Canvas save applied",
        );

        return getWorkflow(tx, tenantId, workflowId);
      });

      return c.json({ data: updated });
    } catch (err) {
      return handleWorkflowError(c, err);
    }
  },
);
