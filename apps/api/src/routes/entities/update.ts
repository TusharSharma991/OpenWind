import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "@platform/auth";
import { db, entityInstances, withTenantContext } from "@platform/db";
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
    const { tenantId, userId, roles } = c.get("auth");
    const input = c.req.valid("json");

    const isAdmin = roles.includes("admin") || roles.includes("agent");

    // `user` role may edit entities assigned to them — fetch to verify assignment
    if (!isAdmin) {
      const [row] = await withTenantContext(tenantId, (tx) =>
        tx
          .select({ assignedTo: entityInstances.assignedTo })
          .from(entityInstances)
          .where(
            and(
              eq(entityInstances.id, id),
              eq(entityInstances.tenantId, tenantId),
            ),
          )
          .limit(1),
      );

      if (row?.assignedTo !== userId) {
        return c.json(
          { error: "Forbidden", message: "Not assigned to this record" },
          403,
        );
      }
    }

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
