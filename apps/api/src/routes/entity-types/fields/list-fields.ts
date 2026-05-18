import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth, requireRole } from "@platform/auth";
import { db } from "@platform/db";
import { listEntityFields, MAX_PAGE_SIZE } from "@platform/entity-engine";
import { factory } from "../factory.js";
import { handleEntityError } from "../../../lib/handle-entity-error.js";

const ListFieldsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
});

export const listEntityFieldsHandler = factory.createHandlers(
  requireAuth(),
  requireRole("admin"),
  zValidator("query", ListFieldsQuerySchema),
  async (c) => {
    const typeId = c.req.param("typeId")!;
    const { cursor, limit } = c.req.valid("query");
    const { tenantId } = c.get("auth");

    try {
      const page = await listEntityFields(db, tenantId, typeId, {
        cursor,
        limit,
      });
      return c.json(page);
    } catch (err) {
      return handleEntityError(c, err);
    }
  },
);
