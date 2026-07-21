import { Hono } from "hono";
import { requireAuth, requireRole } from "@platform/auth";
import { db, tenantUsers, withTenantContext } from "@platform/db";
import { eq } from "drizzle-orm";
import {
  listOrgUsers,
  invalidateUserCache,
} from "../../lib/authnexus-management.js";
import type { AuthContext } from "@platform/auth";

type AppVars = { Variables: { auth: AuthContext } };

export const usersRouter = new Hono<AppVars>();

// GET /users — returns all org users alphabetically by display name.
// Merges AuthNexus org users (source of truth) with tenant_users DB records
// (which hold locally-resolved display names for users who have logged in).
// "user" role included: customers need this to resolve assignee display names on their records.
usersRouter.get(
  "/",
  requireAuth(db),
  requireRole("admin", "agent", "user"),
  async (c) => {
    const { tenantId, orgId } = c.get("auth");
    const bearerToken = c.req.header("Authorization")?.slice(7) ?? "";

    // ?bust=1 clears the in-memory AuthNexus user cache for fresh data
    if (c.req.query("bust") === "1") invalidateUserCache();

    const [orgUsers, dbRows] = await Promise.all([
      orgId ? listOrgUsers(orgId, bearerToken) : Promise.resolve([]),
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

    // Merge: AuthNexus is source of truth for names; DB only enriches when it has
    // a *real* display name (not the userId placeholder stored when JWT has no claims).
    const orgUsersByUserId = new Map(orgUsers.map((u) => [u.userId, u]));
    const merged = orgUsers.map((u) => {
      const dbRow = dbByUserId.get(u.userId);
      // DB display name is only useful when it differs from the userId (i.e. a real name was stored)
      const dbDisplayName =
        dbRow?.displayName && dbRow.displayName !== u.userId
          ? dbRow.displayName
          : null;
      return {
        userId: u.userId,
        email: dbRow?.email ?? u.email,
        displayName: dbDisplayName ?? u.displayName,
        loginName: u.loginName,
      };
    });

    // Also include DB users not returned by AuthNexus (e.g. instance admin in default org).
    // Skip ghost entries: service accounts or stale rows with no email and no real display name.
    for (const r of dbRows) {
      if (!orgUsersByUserId.has(r.userId)) {
        const realName =
          r.displayName && r.displayName !== r.userId ? r.displayName : null;
        // If there's neither a real name nor an email this is a service account / stale entry — skip it
        if (!realName && !r.email) continue;
        merged.push({
          userId: r.userId,
          email: r.email ?? "",
          displayName: realName ?? r.email ?? r.userId,
          loginName: r.email ?? r.userId,
        });
      }
    }

    merged.sort((a, b) => a.displayName.localeCompare(b.displayName));

    return c.json({ data: merged });
  },
);
