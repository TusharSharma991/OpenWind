import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole } from "@platform/auth";
import { db, tenantUsers, withTenantContext } from "@platform/db";
import type { AuthContext } from "@platform/auth";

type AppVars = { Variables: { auth: AuthContext } };

export const usersRouter = new Hono<AppVars>();

usersRouter.get("/", requireAuth(db), requireRole("admin"), async (c) => {
  const { tenantId } = c.get("auth");

  const rows = await withTenantContext(tenantId, (tx) =>
    tx
      .select({
        userId: tenantUsers.userId,
        email: tenantUsers.email,
        displayName: tenantUsers.displayName,
        createdAt: tenantUsers.createdAt,
      })
      .from(tenantUsers)
      .where(eq(tenantUsers.tenantId, tenantId))
      .orderBy(tenantUsers.createdAt),
  );

  return c.json({ data: rows });
});
