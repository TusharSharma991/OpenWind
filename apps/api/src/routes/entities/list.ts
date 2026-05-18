import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "@platform/auth";
import { db } from "@platform/db";
import { listEntities, MAX_PAGE_SIZE } from "@platform/entity-engine";
import { factory } from "./factory.js";
import { handleEntityError } from "../../lib/handle-entity-error.js";

const ListEntitiesQuerySchema = z.object({
  entityTypeId: z.string().uuid(),
  state: z.string().optional(),
  assignedTo: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
  cursor: z.string().optional(),
  includeDeleted: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

export const listEntitiesHandler = factory.createHandlers(
  requireAuth(),
  zValidator("query", ListEntitiesQuerySchema),
  async (c) => {
    const { tenantId } = c.get("auth");
    const query = c.req.valid("query");

    try {
      const page = await listEntities(db, tenantId, query);
      return c.json({ data: page.data, nextCursor: page.nextCursor });
    } catch (err) {
      return handleEntityError(c, err);
    }
  },
);
