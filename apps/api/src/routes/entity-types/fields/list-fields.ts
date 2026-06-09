import { requireAuth } from "@platform/auth";
import { withTenantContext } from "@platform/db";
import { listEntityFields } from "@platform/entity-engine";
import { factory } from "../factory.js";
import { handleEntityError } from "../../../lib/handle-entity-error.js";

export const listEntityFieldsHandler = factory.createHandlers(
  requireAuth(),
  async (c) => {
    const typeId = c.req.param("typeId") ?? "";
    const { tenantId } = c.get("auth");

    try {
      const fields = await withTenantContext(tenantId, (tx) =>
        listEntityFields(tx, tenantId, typeId),
      );
      return c.json({ data: fields });
    } catch (err) {
      return handleEntityError(c, err);
    }
  },
);
