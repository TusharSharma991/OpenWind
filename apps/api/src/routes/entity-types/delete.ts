import { requireAuth, requireRole } from "@platform/auth";
import { db } from "@platform/db";
import { deleteEntityType } from "@platform/entity-engine";
import { factory } from "./factory.js";
import { handleEntityError } from "../../lib/handle-entity-error.js";

export const deleteEntityTypeHandler = factory.createHandlers(
  requireAuth(),
  requireRole("admin"),
  async (c) => {
    const id = c.req.param("id")!;
    const { tenantId } = c.get("auth");

    try {
      await deleteEntityType(db, tenantId, id);
      return c.body(null, 204);
    } catch (err) {
      return handleEntityError(c, err);
    }
  },
);
