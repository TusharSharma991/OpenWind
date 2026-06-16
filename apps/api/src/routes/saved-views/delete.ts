import { requireAuth } from "@platform/auth";
import { withTenantAndUserContext, savedViews } from "@platform/db";
import { eq, and } from "drizzle-orm";
import { factory } from "./factory.js";

export const deleteSavedViewHandler = factory.createHandlers(
  requireAuth(),
  async (c) => {
    const { tenantId, userId } = c.get("auth");
    const id = c.req.param("id") ?? "";

    const deleted = await withTenantAndUserContext(
      tenantId,
      userId,
      async (tx) => {
        const [row] = await tx
          .delete(savedViews)
          .where(
            and(
              eq(savedViews.id, id),
              eq(savedViews.tenantId, tenantId),
              eq(savedViews.userId, userId),
            ),
          )
          .returning({ id: savedViews.id });

        return row;
      },
    );

    if (!deleted) {
      return c.json(
        { error: "NOT_FOUND", message: "Saved view not found" },
        404,
      );
    }

    return c.body(null, 204);
  },
);
