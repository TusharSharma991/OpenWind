import { Hono } from "hono";
import { requireAuth, requireRole } from "@platform/auth";
import { db, tenantUsers, withTenantContext } from "@platform/db";
import { eq } from "drizzle-orm";
import { listOrgUsers } from "../../lib/zitadel-management.js";
import type { AuthContext } from "@platform/auth";

type AppVars = { Variables: { auth: AuthContext } };

export const usersRouter = new Hono<AppVars>();

// GET /users — returns all org users alphabetically by display name.
// Merges Zitadel org users (source of truth) with tenant_users DB records
// (which hold locally-resolved display names for users who have logged in).
// Accessible by admin and agent roles.
usersRouter.get(
  "/",
  requireAuth(db),
  requireRole("admin", "agent"),
  async (c) => {
    const { tenantId } = c.get("auth");

    const [zitadelUsers, dbRows] = await Promise.all([
      listOrgUsers(),
      withTenantContext(tenantId, (tx) =>
        tx
          .select({
            userId: tenantUsers.userId,
            email: tenantUsers.email,
            displayName: tenantUsers.displayName,
          })
          .from(tenantUsers)
          .where(eq(tenantUsers.tenantId, tenantId)),
      ),
    ]);

    // Build a lookup of DB-enriched display names (set on login)
    const dbByUserId = new Map(dbRows.map((r) => [r.userId, r]));

    // Merge: Zitadel is source of truth for user list; DB provides local overrides
    const merged = zitadelUsers.map((u) => {
      const dbRow = dbByUserId.get(u.userId);
      return {
        userId: u.userId,
        email: dbRow?.email ?? u.email,
        displayName: dbRow?.displayName ?? u.displayName,
        loginName: u.loginName,
      };
    });

    // If Zitadel is unreachable fall back to DB-only list
    const list =
      merged.length > 0
        ? merged
        : dbRows.map((r) => ({
            userId: r.userId,
            email: r.email ?? "",
            displayName: r.displayName ?? r.email ?? r.userId,
            loginName: r.email ?? r.userId,
          }));

    list.sort((a, b) => a.displayName.localeCompare(b.displayName));

    return c.json({ data: list });
  },
);
