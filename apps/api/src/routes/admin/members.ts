/**
 * Admin Members — docs/specs/oncall-routing.md T17/T18/R3.
 *
 * PR #602 review (Vijit), BLOCKER-1: the on-call roster's primary/backup/
 * escalation-manager pickers were wrongly sourced from GET /users, which
 * is the customer-facing @mention picker -- it excludes admins so admins
 * don't get @mentioned like customers. On-call assignment needs a
 * separate, admin-only endpoint rather than a role-filter change to
 * /users (which would break its existing customer-only contract).
 *
 * PR #623 review (Vijit), round 2 BLOCKER-1: the role set was briefly
 * expanded to ["agent", "admin", "user"] on the premise that this
 * deployment has no "agent" role in use -- but "user" is specifically the
 * customer role elsewhere (see platform/users.ts's GET /users: "Only
 * surface users holding the 'user' role -- agents/admins must never
 * appear"), and including it here would let a customer be selected as an
 * on-call primary/backup/escalation contact. Reverted to
 * ["agent", "admin"] at that time.
 *
 * 2026-09-25 (hosted-Zitadel switch, on-call roster testing): re-expanded
 * to ["agent", "admin", "user"] deliberately -- confirmed with the owner
 * that this deployment's Zitadel org currently holds no customer/
 * third-party accounts at all; every user in it is internal staff, and
 * "user" here means "staff member without the admin role," not
 * "customer." The PR #623 risk (a real customer becoming pageable)
 * therefore doesn't apply today. This must be revisited -- back to
 * ["agent", "admin"], or a real "agent" role granted to staff instead --
 * the moment a genuine customer/third-party account exists in this same
 * org, since nothing else in this route distinguishes them.
 */

import { Hono } from "hono";
import { requireAuth, requireRole } from "@platform/auth";
import { db } from "@platform/db";
import type { AuthContext } from "@platform/auth";
import { listMergedOrgUsersByRole } from "../platform/users.js";

type Vars = { Variables: { auth: AuthContext } };

export const membersRouter = new Hono<Vars>();

// GET /admin/members — org users holding "agent", "admin", or "user", for
// admin-only assignment pickers (on-call roster primary/backup/
// escalation-manager). See the "user" role note in the header comment above
// before changing this list.
membersRouter.get("/", requireAuth(db), requireRole("admin"), async (c) => {
  const { tenantId, orgId } = c.get("auth");
  const merged = await listMergedOrgUsersByRole(
    tenantId,
    orgId,
    ["agent", "admin", "user"],
    c.req.query("bust") === "1",
  );
  return c.json({ data: merged });
});
