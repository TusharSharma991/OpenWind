import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth, requireRole } from "@platform/auth";
import { db } from "@platform/db";
import { initiateUpload } from "@platform/files";
import { factory } from "./factory.js";

const InitiateUploadSchema = z.object({
  originalName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(100 * 1024 * 1024),
  moduleSlug: z.string().min(1).max(100),
  entityId: z.string().uuid().optional(),
});

export const initiateUploadHandler = factory.createHandlers(
  requireAuth(),
  requireRole("admin", "agent", "member"),
  zValidator("json", InitiateUploadSchema),
  async (c) => {
    const input = c.req.valid("json");
    const { tenantId, userId } = c.get("auth");

    const result = await initiateUpload(
      db,
      tenantId,
      userId,
      input.moduleSlug,
      input.entityId ?? null,
      input.originalName,
      input.mimeType,
      input.sizeBytes,
    );

    return c.json({ data: result }, 201);
  },
);
