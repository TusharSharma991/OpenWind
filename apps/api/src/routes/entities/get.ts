import { requireAuth } from "@platform/auth";
import { withTenantContext } from "@platform/db";
import {
  getEntity,
  getParentId,
  countActiveChildren,
} from "@platform/entity-engine";
import { factory } from "./factory.js";
import { handleEntityError } from "../../lib/handle-entity-error.js";

export const getEntityHandler = factory.createHandlers(
  requireAuth(),
  async (c) => {
    const id = c.req.param("id") ?? "";
    const { tenantId } = c.get("auth");

    try {
      const [instance, parentId, childCount] = await withTenantContext(
        tenantId,
        (tx) =>
          Promise.all([
            getEntity(tx, tenantId, id),
            getParentId(tx, tenantId, id),
            countActiveChildren(tx, tenantId, id),
          ]),
      );
      return c.json({ data: { ...instance, parentId, childCount } });
    } catch (err) {
      return handleEntityError(c, err);
    }
  },
);
