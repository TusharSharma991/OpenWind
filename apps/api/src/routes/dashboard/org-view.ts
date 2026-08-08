import { requireAuth, getSubordinateIds, getUserById } from "@platform/auth";
import { factory } from "./factory.js";
import { handleEntityError } from "../../lib/handle-entity-error.js";
import { resolveUserScopedEntityIds } from "../entities/scoped-access.js";
import {
  buildScopedDashboardSections,
  buildTeamMembersSection,
  DASHBOARD_SCOPE_LIMIT,
} from "./view-builder.js";

// My Org View (docs/specs/my-org-view.md) — AuthNexus-fork-only. Core
// (tushar/TinyPhi) has no equivalent route: Zitadel has no manager/report-chain
// data to back this with, so this file only exists here.
//
// R5/§V (non-negotiable): the target userId for AuthNexus's /connections call
// is ALWAYS c.get("auth").userId (the caller's own, JWT-verified identity) —
// never a query/body param. AuthNexus enforces no per-user authorization
// beyond the org boundary (confirmed 2026-08-08: any org member's token can
// query any other user's connections), so this route is the only place that
// restricts "you can only ever see your own subtree."
export const orgViewHandler = factory.createHandlers(
  requireAuth(),
  async (c) => {
    const { tenantId, userId, orgId } = c.get("auth");
    const now = new Date();
    const bearerToken = c.req.header("Authorization")?.slice(7) ?? "";

    try {
      // No orgId on the token (e.g. an M2M caller, or a claims shape without
      // org_id) — there is nothing to resolve; degrade the same as any other
      // AuthNexus-unreachable case rather than erroring.
      if (!orgId) {
        return c.json({
          data: {
            hasReports: false,
            unavailable: true,
            workflows: [],
            tickets: { items: [], totalQualifying: 0 },
            dueDates: { items: [], totalQualifying: 0 },
            slaRisk: { items: [], totalQualifying: 0 },
            teamMembers: { items: [] },
          },
        });
      }

      const subordinates = await getSubordinateIds(orgId, userId, bearerToken);

      if (subordinates.status === "unavailable" || !subordinates.hasReports) {
        return c.json({
          data: {
            hasReports: subordinates.hasReports,
            unavailable: subordinates.status === "unavailable",
            workflows: [],
            tickets: { items: [], totalQualifying: 0 },
            dueDates: { items: [], totalQualifying: 0 },
            slaRisk: { items: [], totalQualifying: 0 },
            teamMembers: { items: [] },
          },
        });
      }

      const scopedIds = await resolveUserScopedEntityIds(
        tenantId,
        [userId, ...subordinates.ids],
        { limit: DASHBOARD_SCOPE_LIMIT },
      );

      const { rows, ...sections } = await buildScopedDashboardSections(
        tenantId,
        scopedIds,
        now,
        { tenantId, userId, orgId },
      );

      // R12 — roster table: one row per direct/indirect report (never the
      // caller themself), name resolved via AuthNexus (falls back to the raw
      // id if the lookup fails — never drops the row). The same resolved
      // names are reused to annotate tickets.items with assignedToName below
      // (self included) — a single name-resolution pass, not two.
      const memberStats = buildTeamMembersSection(rows, subordinates.ids, now);
      const nameByUserId = new Map<string, string>();
      await Promise.all(
        [userId, ...subordinates.ids].map(async (id) => {
          const user = await getUserById(id, bearerToken);
          if (user) nameByUserId.set(id, user.displayName);
        }),
      );

      const teamMembers = {
        items: memberStats.map((m) => ({
          userId: m.userId,
          name: nameByUserId.get(m.userId) ?? m.userId,
          ticketCount: m.ticketCount,
          overdueCount: m.overdueCount,
        })),
      };

      const tickets = {
        ...sections.tickets,
        items: sections.tickets.items.map((t) => ({
          ...t,
          assignedToName: t.assignedTo
            ? (nameByUserId.get(t.assignedTo) ?? t.assignedTo)
            : null,
        })),
      };

      return c.json({
        data: {
          hasReports: true,
          unavailable: false,
          ...sections,
          tickets,
          teamMembers,
        },
      });
    } catch (err) {
      return handleEntityError(c, err);
    }
  },
);
