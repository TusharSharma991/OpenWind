import { Hono } from "hono";
import { requireAuth } from "@platform/auth";
import { exportQueue } from "../../lib/export-queue.js";
import type { AuthContext } from "@platform/auth";

const router = new Hono<{ Variables: { auth: AuthContext } }>();

router.get("/:jobId/download", requireAuth(), async (c) => {
  const { tenantId } = c.get("auth");
  const jobId = c.req.param("jobId");

  const job = await exportQueue.getJob(jobId);

  if (!job) {
    return c.json({ error: "NOT_FOUND", message: "Export job not found" }, 404);
  }

  // Prevent cross-tenant access — job payload contains the originating tenant
  if (job.data.tenantId !== tenantId) {
    return c.json({ error: "NOT_FOUND", message: "Export job not found" }, 404);
  }

  const state = await job.getState();

  if (state === "completed") {
    const result = job.returnvalue;
    return c.json({ status: "complete", downloadUrl: result.downloadUrl });
  }

  if (state === "failed") {
    return c.json({ status: "failed", error: "EXPORT_FAILED" }, 500);
  }

  return c.json({ status: "pending" }, 202);
});

export { router as exportsRouter };
