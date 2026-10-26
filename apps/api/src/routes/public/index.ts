import { Hono } from "hono";
import { getOrgBrandingBySlugHandler } from "./org-branding.js";

const router = new Hono();

router.get("/org-branding/:slug", ...getOrgBrandingBySlugHandler);

export { router as publicRouter };
