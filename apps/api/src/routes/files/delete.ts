import { requireAuth, requireRole } from "@platform/auth";
import { db } from "@platform/db";
import { deleteFile, FileError } from "@platform/files";
import { factory } from "./factory.js";

export const deleteFileHandler = factory.createHandlers(
  requireAuth(),
  requireRole("admin"),
  async (c) => {
    const fileId = c.req.param("id") ?? "";
    const { tenantId } = c.get("auth");

    try {
      await deleteFile(db, tenantId, fileId);
      return c.body(null, 204);
    } catch (err: unknown) {
      if (err instanceof FileError && err.code === "FILE_NOT_FOUND") {
        return c.json({ error: err.code, message: "File not found" }, 404);
      }
      throw err;
    }
  },
);
