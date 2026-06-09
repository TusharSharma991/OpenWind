import { Hono } from "hono";
import { requireAuth } from "@platform/auth";
import { db } from "@platform/db";
import { listProjectRoles } from "../../lib/zitadel-management.js";
import type { AuthContext } from "@platform/auth";

type AppVars = { Variables: { auth: AuthContext } };

const FALLBACK_ROLES = ["admin", "agent", "user"];

export const rolesRouter = new Hono<AppVars>();

rolesRouter.get("/", requireAuth(db), async (c) => {
  const roles = await listProjectRoles();
  // Fall back to defaults if Zitadel Management API is not configured or unreachable
  return c.json({ data: roles.length > 0 ? roles : FALLBACK_ROLES });
});
