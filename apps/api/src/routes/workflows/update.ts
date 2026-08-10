import { zValidator } from "../../lib/validator.js";
import { z } from "zod";
import { requireAuth, requireRole } from "@platform/auth";
import { withTenantContext } from "@platform/db";
import { updateWorkflow } from "@platform/workflow-engine";
import { factory } from "./factory.js";
import { handleWorkflowError } from "../../lib/handle-workflow-error.js";
import { toWorkflowCaller } from "../../lib/workflow-caller.js";
import { listOrgUsers } from "../../lib/authnexus-management.js";
import { logger } from "@platform/logger";

const UpdateWorkflowSchema = z.object({
  isActive: z.boolean().optional(),
  assignedTo: z.array(z.string()).optional(),
  maxChildDepth: z.number().int().min(0).max(10).nullable().optional(),
  maxChildrenPerParent: z.number().int().min(1).max(100).nullable().optional(),
  initialState: z.string().min(1).max(100).optional(),
});

export const updateWorkflowHandler = factory.createHandlers(
  requireAuth(),
  requireRole("admin", "agent", "user"),
  zValidator("json", UpdateWorkflowSchema),
  async (c) => {
    const id = c.req.param("id") ?? "";
    const auth = c.get("auth");
    const { tenantId, orgId } = auth;
    const input = c.req.valid("json");

    // Verify every workflow-admin user id is a real member of this AuthNexus
    // org before writing. assignedTo here is the workflow-admins array (see
    // migration 0025_workflow_admins_array.sql) — not a single assignee, so
    // every id in the array must be checked, not just one.
    //
    // Checked against AuthNexus directly (the same listOrgUsers call GET
    // /users uses to populate this exact assignment picker), not the local
    // tenant_users cache — tenant_users only gets a row for someone on their
    // *first login* (packages/auth/src/middleware.ts), so a real org member
    // who simply hasn't logged into this app yet would otherwise always
    // fail here despite being a perfectly valid assignee the UI just offered.
    //
    // Dev-only caveat: in non-production, jwks.ts maps every login to
    // DEV_TENANT_ID regardless of the JWT's real org_id, but `orgId` here is
    // always that real org_id, unaffected by the dev override — so this
    // check validates against the caller's *actual* AuthNexus org, which is
    // correct when assigning real org members (the reported bug case), but
    // would reject a fixture/seed-only user who was never a real AuthNexus
    // member of any org. Production has no DEV_TENANT_ID fallback, so
    // orgId/tenantId always correspond correctly there — not an issue.
    if (input.assignedTo !== undefined && input.assignedTo.length > 0) {
      const bearerToken = c.req.header("Authorization")?.slice(7) ?? "";
      const orgUsers = orgId ? await listOrgUsers(orgId, bearerToken) : [];
      const validIds = new Set(orgUsers.map((u) => u.userId));
      const missing = input.assignedTo.filter((id) => !validIds.has(id));
      if (missing.length > 0) {
        // listOrgUsers swallows AuthNexus fetch failures into [] internally
        // (same as every other caller of it, e.g. GET /users) — there's no
        // way to tell "AuthNexus outage" apart from "genuinely empty org" at
        // this call site. Log it so an outage causing every id to look
        // missing is at least diagnosable, rather than silently read as
        // "these users don't exist."
        if (orgUsers.length === 0) {
          logger.warn(
            { orgId, workflowId: id },
            "workflows/update: listOrgUsers returned zero users — either a genuinely empty org or an AuthNexus lookup failure; treating all assignedTo ids as not found",
          );
        }
        return c.json(
          {
            error: "NOT_FOUND",
            message: "One or more users not found in this organization",
          },
          404,
        );
      }
    }

    try {
      const workflow = await withTenantContext(tenantId, (tx) =>
        updateWorkflow(tx, tenantId, id, toWorkflowCaller(auth), input),
      );
      return c.json({ data: workflow });
    } catch (err) {
      return handleWorkflowError(c, err);
    }
  },
);
