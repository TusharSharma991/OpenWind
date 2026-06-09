import { requireAuth, requireRole } from "@platform/auth";
import { db } from "@platform/db";
import { getDownloadUrl, FileError } from "@platform/files";
import { factory } from "./factory.js";

export const getDownloadUrlHandler = factory.createHandlers(
  requireAuth(),
  requireRole("admin", "agent", "member"),
  async (c) => {
    const fileId = c.req.param("id") ?? "";
    const { tenantId } = c.get("auth");

    try {
      const result = await getDownloadUrl(db, tenantId, fileId);
      return c.json({ data: result });
    } catch (err: unknown) {
      if (err instanceof FileError) {
        switch (err.code) {
          case "FILE_NOT_FOUND":
            return c.json({ error: err.code, message: "File not found" }, 404);
          case "FILE_PENDING_SCAN":
            return c.json(
              {
                error: err.code,
                message:
                  "File is pending antivirus scan — try again in a moment",
              },
              422,
            );
          case "FILE_QUARANTINED":
            return c.json(
              { error: err.code, message: "File failed antivirus scan" },
              422,
            );
        }
      }
      throw err;
    }
  },
);
