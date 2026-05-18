import { requireAuth, requireRole } from "@platform/auth";
import { db } from "@platform/db";
import { listEntityFields } from "@platform/entity-engine";
import { factory } from "../factory.js";
import { handleEntityError } from "../../../lib/handle-entity-error.js";

export const listEntityFieldsHandler = factory.createHandlers(
  requireAuth(),
  requireRole("admin"),
  async (c) => {
    const typeId = c.req.param("typeId")!;
    const { tenantId } = c.get("auth");

    try {
      const fields = await listEntityFields(db, tenantId, typeId);
      return c.json({ data: fields });
    } catch (err) {
      return handleEntityError(c, err);
    }
  },
);
