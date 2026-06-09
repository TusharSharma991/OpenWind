import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "@platform/auth";
import { db } from "@platform/db";
import { createEntity } from "@platform/entity-engine";
import { factory } from "./factory.js";
import { handleEntityError } from "../../lib/handle-entity-error.js";

const CreateEntitySchema = z.object({
  entityTypeId: z.string().uuid(),
  fields: z.record(z.unknown()),
  createdBy: z.string().uuid().optional(),
  assignedTo: z.string().uuid().optional(),
  workflowId: z.string().uuid().optional(),
});

export const createEntityHandler = factory.createHandlers(
  requireAuth(),
  zValidator("json", CreateEntitySchema),
  async (c) => {
    const { tenantId } = c.get("auth");
    const input = c.req.valid("json");

    try {
      const instance = await createEntity(db, tenantId, input);
      return c.json({ data: instance }, 201);
    } catch (err) {
      return handleEntityError(c, err);
    }
  },
);
