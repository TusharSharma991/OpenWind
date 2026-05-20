import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth, requireRole } from "@platform/auth";
import { db } from "@platform/db";
import { updateEntityField, isSafeRegex } from "@platform/entity-engine";
import { factory } from "../factory.js";
import { handleEntityError } from "../../../lib/handle-entity-error.js";

const UpdateFieldSchema = z
  .object({
    label: z.string().min(1).max(200).optional(),
    config: z.record(z.unknown()).optional(),
    isRequired: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided",
  });

export const updateEntityFieldHandler = factory.createHandlers(
  requireAuth(),
  requireRole("admin"),
  zValidator("json", UpdateFieldSchema),
  async (c) => {
    const typeId = c.req.param("typeId") ?? "";
    const fieldId = c.req.param("fieldId") ?? "";
    const input = c.req.valid("json");
    const { tenantId } = c.get("auth");

    // ReDoS guard: check config.pattern when it is being updated.
    // zValidator uses synchronous safeParse so async checks must live here.
    const pattern = input.config?.["pattern"];
    if (typeof pattern === "string" && pattern.length > 0) {
      const safe = await isSafeRegex(pattern);
      if (!safe) {
        return c.json(
          {
            error: "VALIDATION_ERROR",
            message: "Validation failed",
            fields: [
              {
                field: "config.pattern",
                code: "INVALID_FORMAT",
                message:
                  "Pattern is invalid or vulnerable to ReDoS — use a simpler regex",
              },
            ],
          },
          422,
        );
      }
    }

    try {
      const field = await updateEntityField(
        db,
        tenantId,
        typeId,
        fieldId,
        input,
      );
      return c.json({ data: field });
    } catch (err) {
      return handleEntityError(c, err);
    }
  },
);
