import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "@platform/auth";
import { withTenantContext } from "@platform/db";
import { createEntity } from "@platform/entity-engine";
import { factory } from "./factory.js";
import { handleEntityError } from "../../lib/handle-entity-error.js";

const CreateEntitySchema = z.object({
  entityTypeId: z.string().uuid(),
  fields: z.record(z.unknown()),
  createdBy: z.string().uuid().optional(),
  assignedTo: z.string().uuid().optional(),
  workflowId: z.string().uuid().optional(),
  currentState: z.string().optional(),
});

export const createEntityHandler = factory.createHandlers(
  requireAuth(),
  zValidator("json", CreateEntitySchema),
  async (c) => {
    const { tenantId, userId } = c.get("auth");
    const input = c.req.valid("json");

    try {
      const instance = await withTenantContext(tenantId, (tx) =>
        createEntity(tx, tenantId, {
          ...input,
          // actorId stores the raw Zitadel ID (text) for event history display.
          // createdBy is UUID-only; skip if userId is a snowflake number.
          actorId: userId,
          createdBy:
            input.createdBy ??
            (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              userId,
            )
              ? userId
              : undefined),
        }),
      );
      return c.json({ data: instance }, 201);
    } catch (err) {
      return handleEntityError(c, err);
    }
  },
);
