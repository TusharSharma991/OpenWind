import { Hono } from "hono";
import type { AuthContext } from "@platform/auth";
import {
  getNotificationPrefsHandler,
  updateNotificationPrefsHandler,
} from "./notifications.js";

const router = new Hono<{ Variables: { auth: AuthContext } }>();

router.get("/notifications", ...getNotificationPrefsHandler);
router.patch("/notifications", ...updateNotificationPrefsHandler);

export { router as preferencesRouter };
