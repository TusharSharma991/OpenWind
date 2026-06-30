import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "@platform/auth";
import { db } from "@platform/db";
import {
  listChildInstances,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "@platform/entity-engine";
import { factory } from "./factory.js";
import { handleEntityError } from "../../lib/handle-entity-error.js";

const ListChildrenQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
});

export const listChildrenHandler = factory.createHandlers(
  requireAuth(),
  zValidator("query", ListChildrenQuerySchema),
  async (c) => {
    const parentId = c.req.param("id") ?? "";
    const query = c.req.valid("query");
    const { tenantId } = c.get("auth");

    try {
      const page = await listChildInstances(db, tenantId, parentId, {
        ...(query.cursor !== undefined && { cursor: query.cursor }),
        limit: query.limit,
      });
      return c.json({ data: page.data, nextCursor: page.nextCursor });
    } catch (err) {
      return handleEntityError(c, err);
    }
  },
);
