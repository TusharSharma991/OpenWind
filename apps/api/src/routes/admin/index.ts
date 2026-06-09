import { Hono } from "hono";
import type { AuthContext } from "@platform/auth";
import { getAuditLogHandler } from "./audit.js";
import {
  getViewConfigHandler,
  updateViewConfigHandler,
} from "./view-configs.js";

const router = new Hono<{ Variables: { auth: AuthContext } }>();

router.get("/audit", ...getAuditLogHandler);
router.get("/view-configs/:entityType", ...getViewConfigHandler);
router.patch("/view-configs/:entityType", ...updateViewConfigHandler);

export { router as adminRouter };
