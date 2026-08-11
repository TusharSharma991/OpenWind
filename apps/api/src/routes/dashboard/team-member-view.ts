import { requireAuth, getSubordinateIds, getUserById } from "@platform/auth";
import { factory } from "./factory.js";
import { handleEntityError } from "../../lib/handle-entity-error.js";
import { resolveUserScopedEntityIds } from "../entities/scoped-access.js";
import {
  buildScopedDashboardSections,
  DASHBOARD_SCOPE_LIMIT,
} from "./view-builder.js";

// "View as subordinate" (docs/specs/my-org-view.md R13) — AuthNexus-fork-only.
// Lets a manager see a direct/indirect report's own personal dashboard,
// reusing the exact same ticket-scoped pipeline my-view.ts uses for the
// caller's own tickets, just pointed at :userId instead.
//
// R13/§V (non-negotiable, mirrors org-view.ts's R5): the target userId is
// taken from the URL param but is NEVER trusted directly — it must appear in
// getSubordinateIds(orgId, callerUserId, ...).ids, verified fresh on every
// request, or the request 404s. AuthNexus enforces no per-user authorization
// beyond the org boundary, so this app-level check is the only thing standing
// between "my manager can see my dashboard" and "any org member can see
// anyone's dashboard by guessing a userId."
//
// Scope is deliberately narrower than my-view.ts's own response: only the
// ticket-scoped sections (workflows/tickets/dueDates/slaRisk) are returned.
// adminWorkflows/savedViews/pendingApprovals are personal-workspace items
// with no clear team-visibility justification, so they're always empty here
// — a manager sees a subordinate's ticket load, not their saved filters or
// approval queue.
export const teamMemberViewHandler = factory.createHandlers(
  requireAuth(),
  async (c) => {
    const { tenantId, userId, orgId } = c.get("auth");
    const targetUserId = c.req.param("userId");
    const now = new Date();
    const bearerToken = c.req.header("Authorization")?.slice(7) ?? "";

    try {
      // No orgId, or AuthNexus unreachable — fail CLOSED (404), unlike
      // org-view.ts's own dashboard probe which degrades to an
      // unavailable:true banner. There, degrading is safe because it only
      // ever describes the caller's own reports. Here, the entire point of
      // the request is an authorization decision — if we can't verify the
      // target is actually a subordinate, we must not show their data.
      if (!orgId || !targetUserId) {
        return c.json({ error: "NOT_FOUND", message: "User not found" }, 404);
      }

      const subordinates = await getSubordinateIds(orgId, userId, bearerToken);
      if (
        subordinates.status === "unavailable" ||
        !subordinates.ids.includes(targetUserId)
      ) {
        return c.json({ error: "NOT_FOUND", message: "User not found" }, 404);
      }

      const [targetUser, scopedIds] = await Promise.all([
        getUserById(targetUserId, bearerToken),
        resolveUserScopedEntityIds(tenantId, [targetUserId], {
          limit: DASHBOARD_SCOPE_LIMIT,
        }),
      ]);

      const { workflows, tickets, dueDates, slaRisk } =
        await buildScopedDashboardSections(tenantId, scopedIds, now, {
          tenantId,
          userId,
          targetUserId,
        });

      return c.json({
        data: {
          targetUser: {
            userId: targetUserId,
            name: targetUser?.displayName ?? targetUserId,
          },
          workflows,
          tickets,
          dueDates,
          slaRisk,
          adminWorkflows: [],
          savedViews: [],
          pendingApprovals: { items: [], totalQualifying: 0 },
        },
      });
    } catch (err) {
      return handleEntityError(c, err);
    }
  },
);
