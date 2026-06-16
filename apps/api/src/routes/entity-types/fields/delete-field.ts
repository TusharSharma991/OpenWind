import { requireAuth, requireRole } from "@platform/auth";
import { withTenantContext } from "@platform/db";
import { deleteEntityField } from "@platform/entity-engine";
import { factory } from "../factory.js";
import { handleEntityError } from "../../../lib/handle-entity-error.js";

export const deleteEntityFieldHandler = factory.createHandlers(
  requireAuth(),
  requireRole("admin"),
  async (c) => {
    const typeId = c.get("typeId");
    const fieldId = c.req.param("fieldId") ?? "";
    const { tenantId } = c.get("auth");

    try {
      await withTenantContext(tenantId, (tx) =>
        deleteEntityField(tx, tenantId, typeId, fieldId),
      );
      return c.body(null, 204);
    } catch (err) {
      return handleEntityError(c, err);
    }
  },
);
