import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "@platform/auth";
import { withTenantContext } from "@platform/db";
import { updateEntity } from "@platform/entity-engine";
import { factory } from "./factory.js";
import { handleEntityError } from "../../lib/handle-entity-error.js";

const UpdateEntitySchema = z.object({
  fields: z.record(z.unknown()).optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  currentState: z.string().optional(),
});

export const updateEntityHandler = factory.createHandlers(
  requireAuth(),
  zValidator("json", UpdateEntitySchema),
  async (c) => {
    const id = c.req.param("id") ?? "";
    const { tenantId, userId } = c.get("auth");
    const input = c.req.valid("json");

    try {
      const instance = await withTenantContext(tenantId, (tx) =>
        updateEntity(tx, tenantId, id, {
          ...input,
          actorId: userId,
          updatedBy: userId,
        }),
      );
      return c.json({ data: instance });
    } catch (err) {
      return handleEntityError(c, err);
    }
  },
);
