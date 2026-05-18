import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth, requireRole } from "@platform/auth";
import { db } from "@platform/db";
import { bulkSetState, BULK_MAX_ITEMS } from "@platform/entity-engine";
import { factory } from "./factory.js";
import { handleEntityError } from "../../lib/handle-entity-error.js";

const BulkSetStateSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        state: z.string().min(1).max(100),
      }),
    )
    .min(1)
    .max(BULK_MAX_ITEMS),
});

export const bulkSetStateHandler = factory.createHandlers(
  requireAuth(),
  requireRole("admin", "agent"),
  zValidator("json", BulkSetStateSchema),
  async (c) => {
    const { tenantId } = c.get("auth");
    const { items } = c.req.valid("json");

    try {
      const result = await bulkSetState(db, tenantId, items);
      return c.json({ data: result });
    } catch (err) {
      return handleEntityError(c, err);
    }
  },
);
