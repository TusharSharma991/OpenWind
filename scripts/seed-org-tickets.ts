#!/usr/bin/env tsx
/**
 * seed-org-tickets.ts
 *
 * Seeds ~48 realistic helpdesk tickets (+ workflow-event comments, + per-instance
 * access grants) for the AuthNexus test org (372001791581093891) so the local
 * UI has real-looking data to demo/test against.
 *
 * Deliberately bypasses packages/entity-engine's createEntity()/addComment() —
 * inserts entity_instances / workflow_events rows directly inside
 * withTenantContext so RLS is exercised the same way production writes are,
 * but no outbox_events rows are written. That means no automation_rules firing
 * and no notifications/emails sent — this is look-and-feel seed data only;
 * automation/notification behavior is tested separately.
 *
 * Run:
 *   pnpm exec dotenv -e .env.local -- tsx scripts/seed-org-tickets.ts
 */

import "dotenv/config";
import { withTenantContext, entityTypes, workflows } from "@platform/db";
import { entityInstances } from "@platform/db";
import { workflowEvents } from "@platform/db";
import { eq, and } from "drizzle-orm";

const DEV_TENANT_ID =
  process.env["DEV_TENANT_ID"] ?? "00000000-0000-0000-0000-000000000001";

const TICKET_COUNT = 48;

// --- AuthNexus test-org roster (org 372001791581093891) ------------------
interface OrgUser {
  id: string;
  name: string;
  dept: string;
  managerId: string | null;
}

const USERS: OrgUser[] = [
  {
    id: "373759519982878723",
    name: "admin admin",
    dept: "MANAGEMENT",
    managerId: null,
  },
  {
    id: "373453726783897603",
    name: "Tarundeep Manav",
    dept: "SALES",
    managerId: "373759519982878723",
  },
  {
    id: "373446114155692035",
    name: "TI Admin",
    dept: "OPERATIONS",
    managerId: "373759519982878723",
  },
  {
    id: "372021449377972227",
    name: "AM Admin",
    dept: "ENGINEERING",
    managerId: "373759519982878723",
  },
  {
    id: "374487847148716035",
    name: "Priyanka Kushwaha",
    dept: "SALES",
    managerId: "373453726783897603",
  },
  {
    id: "373453864726167555",
    name: "analyst user",
    dept: "SALES",
    managerId: "373453726783897603",
  },
  {
    id: "373590470422429699",
    name: "Deepika Sijwali",
    dept: "SALES",
    managerId: "374487847148716035",
  },
  {
    id: "372447581956997123",
    name: "John Doe",
    dept: "SALES",
    managerId: "374487847148716035",
  },
  {
    id: "372828325137088515",
    name: "Test user",
    dept: "SALES",
    managerId: "374487847148716035",
  },
  {
    id: "372991171187703811",
    name: "Vinod Modi",
    dept: "SALES",
    managerId: "374487847148716035",
  },
  {
    id: "373463565731889155",
    name: "Rahul Gupta",
    dept: "SALES",
    managerId: "374487847148716035",
  },
  {
    id: "372979616198950915",
    name: "test-John test-Doe",
    dept: "SUPPORT",
    managerId: "374487847148716035",
  },
  {
    id: "373473222277988355",
    name: "T Test",
    dept: "SALES",
    managerId: "373590470422429699",
  },
  {
    id: "373525095819247619",
    name: "hhhh .",
    dept: "SUPPORT",
    managerId: "373590470422429699",
  },
  {
    id: "373614056839315459",
    name: "Jai Shah",
    dept: "SALES",
    managerId: "373590470422429699",
  },
  {
    id: "374864074405576707",
    name: "Vinod Kamle",
    dept: "SUPPORT",
    managerId: "373590470422429699",
  },
  {
    id: "382580897309786115",
    name: "ow Admin",
    dept: "OPERATIONS",
    managerId: "373446114155692035",
  },
  {
    id: "382581101706608643",
    name: "Carol KC",
    dept: "OPERATIONS",
    managerId: "373446114155692035",
  },
  {
    id: "374345824441729027",
    name: "Navneet .",
    dept: "OPERATIONS",
    managerId: "382580897309786115",
  },
  {
    id: "382581166332444675",
    name: "Bob DS",
    dept: "OPERATIONS",
    managerId: "382580897309786115",
  },
  {
    id: "380870693274779651",
    name: "Rakhi Singh",
    dept: "ENGINEERING",
    managerId: "372021449377972227",
  },
  {
    id: "382320454452379651",
    name: "Ztest Dummy",
    dept: "ENGINEERING",
    managerId: "372021449377972227",
  },
  {
    id: "374346073096847363",
    name: "Mathew Smith",
    dept: "ENGINEERING",
    managerId: "380870693274779651",
  },
  {
    id: "373594629779488771",
    name: "test user",
    dept: "ENGINEERING",
    managerId: "380870693274779651",
  },
  {
    id: "372022447085453315",
    name: "Bikash Prasad Barnwal",
    dept: "HR",
    managerId: null,
  },
  { id: "373617226642620419", name: "test emp", dept: "HR", managerId: null },
  { id: "374921592557273091", name: "Anil Soni", dept: "QA", managerId: null },
  { id: "375017737396682755", name: "test nms", dept: "QA", managerId: null },
  {
    id: "372565653309095939",
    name: "Dhanjay Singh",
    dept: "NONE",
    managerId: null,
  },
  {
    id: "372753963465834499",
    name: "test user 2",
    dept: "NONE",
    managerId: null,
  },
  {
    id: "372979808415514627",
    name: "test-John-2 test-Doe-2",
    dept: "NONE",
    managerId: null,
  },
  { id: "382582538675159043", name: "Dummy User", dept: "QA", managerId: null },
  {
    id: "385095933068574723",
    name: "Dummy Tester",
    dept: "TESTING",
    managerId: null,
  },
];

const byId = new Map(USERS.map((u) => [u.id, u]));
function managerOf(userId: string): OrgUser | undefined {
  const u = byId.get(userId);
  return u?.managerId ? byId.get(u.managerId) : undefined;
}

// Helpdesk primarily serves/staffed by SALES + SUPPORT + OPERATIONS.
const PRIMARY_DEPTS = new Set(["SALES", "SUPPORT", "OPERATIONS"]);
const primaryUsers = USERS.filter((u) => PRIMARY_DEPTS.has(u.dept));
const otherUsers = USERS.filter((u) => !PRIMARY_DEPTS.has(u.dept));

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}
function pickWeighted<T>(items: Array<[T, number]>): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [item, w] of items) {
    r -= w;
    if (r <= 0) return item;
  }
  const fallback = items[items.length - 1];
  if (!fallback)
    throw new Error("pickWeighted called with an empty items array");
  return fallback[0];
}
// Skew: primary-dept users assigned/created 80% of the time, others 20%.
function pickAssignee(): OrgUser {
  return Math.random() < 0.8 ? pick(primaryUsers) : pick(otherUsers);
}

type Category = "technical" | "billing" | "general";
type Priority = "low" | "medium" | "high" | "urgent";
type State = "open" | "in_progress" | "pending" | "resolved";

const CATEGORIES: Array<[Category, number]> = [
  ["technical", 45],
  ["general", 35],
  ["billing", 20],
];
const PRIORITIES: Array<[Priority, number]> = [
  ["low", 30],
  ["medium", 40],
  ["high", 20],
  ["urgent", 10],
];
const STATES: Array<[State, number]> = [
  ["open", 25],
  ["in_progress", 30],
  ["pending", 15],
  ["resolved", 30],
];

const TITLES: Record<Category, string[]> = {
  technical: [
    "Login page throws 500 error intermittently",
    "Dashboard widgets not loading on Safari",
    "API returns stale data after cache invalidation",
    "File upload fails for attachments over 10MB",
    "Notification bell icon shows wrong unread count",
    "Search results missing recently created tickets",
    "Export to CSV truncates long descriptions",
    "SSO redirect loop after password reset",
    "Mobile app crashes when opening ticket detail",
    "Webhook delivery delayed by several minutes",
    "Custom field values not saving on form submit",
    "Bulk assign action times out for large selections",
  ],
  billing: [
    "Invoice #INV-2291 shows incorrect tax amount",
    "Refund not reflected in account balance",
    "Duplicate charge on this month's subscription",
    "Unable to update payment method on file",
    "Requesting itemized invoice for Q2 renewal",
    "Proration credit missing after plan downgrade",
    "Currency shown as USD instead of contracted INR",
    "Auto-renewal charged despite cancellation request",
  ],
  general: [
    "Requesting access to the analytics workspace",
    "How do I add a new team member to this org?",
    "Clarification needed on data retention policy",
    "Feature request: dark mode for admin console",
    "Onboarding checklist link is broken",
    "Need guidance on setting up SLA rules",
    "Question about role permissions for agents",
    "Follow-up on last week's training session",
    "Requesting a walkthrough of the reporting module",
    "General feedback on the new dashboard layout",
  ],
};

const DESCRIPTIONS: Record<Category, string[]> = {
  technical: [
    "Started happening after the last deploy. Can reproduce by refreshing a few times in a row.",
    "Confirmed on two different machines, same browser version. Console shows a network error.",
    "Customer reported this via email with a screenshot attached; forwarding for investigation.",
    "Only affects accounts created in the last 30 days, seems tied to a recent schema change.",
  ],
  billing: [
    "Customer flagged this during the monthly reconciliation call. Needs resolution before next invoice cycle.",
    "Finance team noticed the discrepancy during audit. Please review and confirm correct amount.",
    "Customer has been a good-standing account for 2 years, escalating for quick turnaround.",
  ],
  general: [
    "Came in via the support inbox, routing to the right team for visibility.",
    "Low urgency, but would like a response within the week if possible.",
    "Raised during today's stand-up as something worth tracking formally.",
  ],
};

const COMMENT_TEMPLATES: Record<Category, string[]> = {
  technical: [
    "Reproduced on staging, checking logs now.",
    "Looks like a race condition in the cache layer — investigating further.",
    "Deployed a fix to staging, waiting on QA sign-off before promoting.",
    "Confirmed root cause, patch going out with tomorrow's release.",
    "Can't reproduce on my end — could you share the exact steps again?",
  ],
  billing: [
    "Refund processed, awaiting confirmation from customer.",
    "Confirmed the discrepancy with finance, correcting the invoice now.",
    "Escalated to billing ops for a manual adjustment.",
    "Customer confirmed resolution, closing out shortly.",
  ],
  general: [
    "Following up with the customer for more context.",
    "Looped in the team lead for visibility on this one.",
    "Shared the requested documentation link.",
    "Scheduled a call to walk through this together.",
  ],
};

async function main(): Promise<void> {
  console.warn(
    `Seeding ${TICKET_COUNT} tickets for tenant ${DEV_TENANT_ID}...`,
  );

  let created = 0;

  await withTenantContext(DEV_TENANT_ID, async (tx) => {
    const [ticketType] = await tx
      .select()
      .from(entityTypes)
      .where(
        and(
          eq(entityTypes.name, "ticket"),
          eq(entityTypes.tenantId, DEV_TENANT_ID),
        ),
      )
      .limit(1);
    if (!ticketType) {
      throw new Error(
        "No 'ticket' entity_type found for this tenant — run module install / seed first.",
      );
    }
    const entityTypeId = ticketType.id;

    const [wf] = await tx
      .select()
      .from(workflows)
      .where(
        and(
          eq(workflows.entityTypeId, entityTypeId),
          eq(workflows.tenantId, DEV_TENANT_ID),
        ),
      )
      .limit(1);
    if (!wf) {
      throw new Error(
        "No workflow found for the ticket entity type on this tenant.",
      );
    }
    const workflowId = wf.id;

    for (let i = 0; i < TICKET_COUNT; i++) {
      const category = pickWeighted(CATEGORIES);
      const priority = pickWeighted(PRIORITIES);
      const state = pickWeighted(STATES);
      const creator = pickAssignee();
      const assignee = Math.random() < 0.85 ? pickAssignee() : creator;

      const title = pick(TITLES[category]);
      const description = pick(DESCRIPTIONS[category]);

      // ~30% of tickets get an extra access grant beyond creator/assignee.
      const accessUsers: Record<string, { level: string; tag?: string }> = {};
      if (Math.random() < 0.3) {
        const mgr = managerOf(assignee.id);
        if (mgr) {
          accessUsers[mgr.id] = { level: "read_only" };
        } else {
          const teammate = pick(
            primaryUsers.filter((u) => u.id !== assignee.id),
          );
          accessUsers[teammate.id] = { level: "read_comment", tag: "mention" };
        }
      }

      const createdAt = new Date(
        Date.now() - Math.floor(Math.random() * 45) * 86_400_000,
      );

      const [instance] = await tx
        .insert(entityInstances)
        .values({
          entityTypeId,
          tenantId: DEV_TENANT_ID,
          workflowId,
          currentState: state,
          fields: {
            title,
            description,
            priority,
            category,
            ...(Object.keys(accessUsers).length > 0
              ? { __accessUsers: accessUsers }
              : {}),
          },
          createdBy: creator.id,
          assignedTo: assignee.id,
          createdAt,
          updatedAt: createdAt,
        })
        .returning({ id: entityInstances.id });
      if (!instance) throw new Error("entity_instances insert returned no row");
      const instanceId = instance.id;

      // Backfill a "create" workflow_event so history isn't empty.
      await tx.insert(workflowEvents).values({
        tenantId: DEV_TENANT_ID,
        instanceId,
        workflowId,
        fromState: null,
        toState: "open",
        triggeredBy: "seed",
        actorId: creator.id,
        createdAt,
      });

      // pending/resolved tickets get >=1 comment (their transitions require
      // one in real usage); open/in_progress get a smaller chance too.
      const commentCount =
        state === "resolved" || state === "pending"
          ? 1 + Math.floor(Math.random() * 3)
          : Math.random() < 0.4
            ? 1
            : 0;

      const path: string[] =
        state === "in_progress"
          ? ["in_progress"]
          : state === "pending"
            ? ["in_progress", "pending"]
            : state === "resolved"
              ? ["in_progress", "resolved"]
              : [];

      let prevState = "open";
      for (let c = 0; c < commentCount; c++) {
        const author = Math.random() < 0.7 ? assignee : creator;
        const text = pick(COMMENT_TEMPLATES[category]);
        const toState = path[Math.min(c, path.length - 1)] ?? prevState;
        const commentAt = new Date(
          createdAt.getTime() +
            (c + 1) * 3_600_000 * (1 + Math.floor(Math.random() * 12)),
        );
        await tx.insert(workflowEvents).values({
          tenantId: DEV_TENANT_ID,
          instanceId,
          workflowId,
          fromState: prevState,
          toState,
          triggeredBy: "seed",
          actorId: author.id,
          comment: text,
          metadata: { type: "comment", text },
          createdAt: commentAt,
        });
        prevState = toState;
      }

      created++;
    }
  });

  console.warn(`Seed complete — ${created} tickets created.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
