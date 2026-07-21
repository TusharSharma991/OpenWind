import { Hono } from "hono";
import { requireAuth, requireRole } from "@platform/auth";
import { db } from "@platform/db";
import { listProjectRoles } from "../../lib/authnexus-management.js";
import type { AuthContext } from "@platform/auth";

type AppVars = { Variables: { auth: AuthContext } };

const FALLBACK_ROLES = ["admin", "agent", "user"];

export const rolesRouter = new Hono<AppVars>();

rolesRouter.get("/", requireAuth(db), requireRole("admin"), async (c) => {
  const { orgId } = c.get("auth");
  const bearerToken = c.req.header("Authorization")?.slice(7) ?? "";
  const roles = orgId ? await listProjectRoles(orgId, bearerToken) : [];
  // Fall back to defaults if AuthNexus is unreachable or returns no grants yet.
  return c.json({ data: roles.length > 0 ? roles : FALLBACK_ROLES });
});
