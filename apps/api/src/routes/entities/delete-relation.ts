import { requireAuth, requireRole } from "@platform/auth";
import { db } from "@platform/db";
import { deleteRelation } from "@platform/entity-engine";
import { factory } from "./factory.js";
import { handleEntityError } from "../../lib/handle-entity-error.js";

export const deleteRelationHandler = factory.createHandlers(
  requireAuth(),
  requireRole("admin", "agent"),
  async (c) => {
    const relationId = c.req.param("relationId") ?? "";
    const { tenantId } = c.get("auth");

    try {
      await deleteRelation(db, tenantId, relationId);
      return c.body(null, 204);
    } catch (err) {
      return handleEntityError(c, err);
    }
  },
);
