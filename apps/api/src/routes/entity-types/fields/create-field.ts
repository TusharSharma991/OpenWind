import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth, requireRole } from "@platform/auth";
import { db } from "@platform/db";
import { addEntityField, FIELD_TYPES } from "@platform/entity-engine";
import { factory } from "../factory.js";
import { handleEntityError } from "../../../lib/handle-entity-error.js";

const CreateFieldSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z_][a-z0-9_]*$/, "field name must be snake_case"),
  label: z.string().min(1).max(200),
  fieldType: z.enum(FIELD_TYPES),
  config: z.record(z.unknown()).default({}),
  isRequired: z.boolean().default(false),
  isIndexed: z.boolean().default(false),
  sortOrder: z.number().int().min(0).default(0),
});

export const createEntityFieldHandler = factory.createHandlers(
  requireAuth(),
  requireRole("admin"),
  zValidator("json", CreateFieldSchema),
  async (c) => {
    const typeId = c.req.param("typeId")!;
    const input = c.req.valid("json");
    const { tenantId } = c.get("auth");

    try {
      const field = await addEntityField(db, tenantId, typeId, {
        entityTypeId: typeId,
        name: input.name,
        label: input.label,
        fieldType: input.fieldType,
        config: input.config,
        isRequired: input.isRequired,
        isIndexed: input.isIndexed,
        isSystem: false,
        sortOrder: input.sortOrder,
        createdAt: new Date(),
      });
      return c.json({ data: field }, 201);
    } catch (err) {
      return handleEntityError(c, err);
    }
  },
);
