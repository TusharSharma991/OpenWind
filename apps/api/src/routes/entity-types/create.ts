import { zValidator } from "../../lib/validator.js";
import { z } from "zod";
import { requireAuth, requireRole } from "@platform/auth";
import { withTenantContext } from "@platform/db";
import { createEntityType, addEntityField } from "@platform/entity-engine";
import { factory } from "./factory.js";
import { handleEntityError } from "../../lib/handle-entity-error.js";

const CreateEntityTypeSchema = z.object({
  name: z.string().min(1).max(100),
  plural: z.string().min(1).max(100),
  icon: z.string().optional(),
  moduleId: z.string().uuid().optional(),
  allowCustomFields: z.boolean().default(true),
});

export const createEntityTypeHandler = factory.createHandlers(
  requireAuth(),
  requireRole("admin"),
  zValidator("json", CreateEntityTypeSchema),
  async (c) => {
    const input = c.req.valid("json");
    const { tenantId } = c.get("auth");

    try {
      const entityType = await withTenantContext(tenantId, async (tx) => {
        const created = await createEntityType(tx, tenantId, input);
        // Every entity type created through this route (the admin-ui "Create
        // Workflow" wizard) gets a non-negotiable 'title' field, mirroring
        // the generic Due Date/Assigned To/Remark system columns every
        // ticket already carries (see apps/admin-ui's "Details to Collect"
        // tab — these four are pinned there with no delete action,
        // label-only edits). Deliberately NOT inside createEntityType()
        // itself — that function is called directly by ~26 test suites and
        // other internal flows that create entity types with zero fields on
        // purpose; seeding here keeps that contract intact for everyone else.
        await addEntityField(tx, tenantId, created.id, {
          entityTypeId: created.id,
          createdAt: new Date(),
          name: "title",
          label: "Title / Unique ID",
          fieldType: "text",
          config: {},
          isRequired: true,
          isIndexed: true,
          isSystem: true,
          sortOrder: 0,
          sensitivity: "internal",
        });
        return created;
      });
      return c.json({ data: entityType }, 201);
    } catch (err) {
      return handleEntityError(c, err);
    }
  },
);
