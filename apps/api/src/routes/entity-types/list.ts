import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth, requireRole } from "@platform/auth";
import { db } from "@platform/db";
import { listEntityTypes } from "@platform/entity-engine";
import { factory } from "./factory.js";
import { handleEntityError } from "../../lib/handle-entity-error.js";

const ListEntityTypesQuerySchema = z.object({
  moduleId: z.string().uuid().optional(),
});

export const listEntityTypesHandler = factory.createHandlers(
  requireAuth(),
  requireRole("admin"),
  zValidator("query", ListEntityTypesQuerySchema),
  async (c) => {
    const { moduleId } = c.req.valid("query");
    const { tenantId } = c.get("auth");

    try {
      const entityTypesList = await listEntityTypes(db, tenantId, { moduleId });
      return c.json({ data: entityTypesList });
    } catch (err) {
      return handleEntityError(c, err);
    }
  },
);
