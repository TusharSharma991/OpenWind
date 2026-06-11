import { Hono } from "hono";
import type { AuthContext } from "@platform/auth";
import { requireAuth, requireRole } from "@platform/auth";
import { db } from "@platform/db";
import { logger } from "@platform/logger";
import { ModuleService } from "../../services/module-service.js";

type Vars = { Variables: { auth: AuthContext } };

const router = new Hono<Vars>();

// Require authentication for all module routes
router.use("*", requireAuth(db));

// List modules status for the current tenant
router.get("/", async (c) => {
  const auth = c.get("auth");
  try {
    const list = await ModuleService.listModules(auth.tenantId);
    return c.json({ data: list });
  } catch (err: unknown) {
    logger.error({ err, tenantId: auth.tenantId }, "listModules failed");
    return c.json({ error: "INTERNAL_ERROR", message: String(err) }, 500);
  }
});

// Install a module (admin only)
router.post("/:slug/install", requireRole("admin"), async (c) => {
  const auth = c.get("auth");
  const slug = c.req.param("slug");

  let workflowName: string | undefined;
  try {
    const body = await c.req.json<{ workflowName?: string }>();
    workflowName =
      typeof body.workflowName === "string" && body.workflowName.trim()
        ? body.workflowName.trim()
        : undefined;
  } catch {
    // body is optional — empty or non-JSON body is fine
  }

  try {
    await ModuleService.installModule(auth.tenantId, slug, { workflowName });
    return c.json({
      status: "success",
      message: `Module '${slug}' installed successfully`,
    });
  } catch (err: unknown) {
    return c.json({ error: "INSTALL_FAILED", message: String(err) }, 500);
  }
});

// Uninstall a module (admin only)
router.post("/:slug/uninstall", requireRole("admin"), async (c) => {
  const auth = c.get("auth");
  const slug = c.req.param("slug");

  try {
    await ModuleService.uninstallModule(auth.tenantId, slug);
    return c.json({
      status: "success",
      message: `Module '${slug}' uninstalled successfully`,
    });
  } catch (err: unknown) {
    return c.json({ error: "UNINSTALL_FAILED", message: String(err) }, 500);
  }
});

export { router as modulesRouter };
