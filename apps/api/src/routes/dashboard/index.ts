import { Hono } from "hono";
import type { AuthContext } from "@platform/auth";
import { myViewHandler } from "./my-view.js";
import { orgViewHandler } from "./org-view.js";

const router = new Hono<{ Variables: { auth: AuthContext } }>();

router.get("/my-view", ...myViewHandler);
// My Org View (docs/specs/my-org-view.md) — AuthNexus-fork-only, no core equivalent.
router.get("/org-view", ...orgViewHandler);

export { router as dashboardRouter };
