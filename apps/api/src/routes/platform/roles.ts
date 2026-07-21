import { Hono } from "hono";
import { requireAuth, requireRole } from "@platform/auth";
import { db } from "@platform/db";
import { listProjectRoles } from "../../lib/authnexus-management.js";
import type { AuthContext } from "@platform/auth";

type AppVars = { Variables: { auth: AuthContext } };

const FALLBACK_ROLES = ["admin", "agent", "user"];

export const rolesRouter = new Hono<AppVars>();

rolesRouter.get("/", requireAuth(db), requireRole("admin"), async (c) => {
  const roles = await listProjectRoles();
  // AuthNexus has no project-roles listing endpoint — always falls back to defaults.
  return c.json({ data: roles.length > 0 ? roles : FALLBACK_ROLES });
});
