import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth, requireRole } from "@platform/auth";
import { db } from "@platform/db";
import { updateEntity } from "@platform/entity-engine";
import { factory } from "./factory.js";
import { handleEntityError } from "../../lib/handle-entity-error.js";

const UpdateEntitySchema = z.object({
  fields: z.record(z.unknown()).optional(),
  assignedTo: z.string().uuid().nullable().optional(),
});

export const updateEntityHandler = factory.createHandlers(
  requireAuth(),
  requireRole("admin", "agent"),
  zValidator("json", UpdateEntitySchema),
  async (c) => {
    const id = c.req.param("id") ?? "";
    const { tenantId, userId } = c.get("auth");
    const input = c.req.valid("json");

    try {
      const instance = await updateEntity(db, tenantId, id, {
        ...input,
        actorId: userId,
        actorType: "user",
      });
      return c.json({ data: instance });
    } catch (err) {
      return handleEntityError(c, err);
    }
  },
);
