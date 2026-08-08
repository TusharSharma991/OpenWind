#!/usr/bin/env tsx
/**
 * seed-secondary-workflows.ts
 *
 * Seeds realistic records (+ workflow-event comments, + due dates, + occasional
 * access grants) into the four standalone workflows installed via
 * `work docs/workflow scripts/scripts/*\/up.sql`:
 *   sales_tender_opportunity, order_fulfillment, payment_followup,
 *   nsi_amendment_request
 *
 * Same approach as scripts/seed-org-tickets.ts: direct Drizzle inserts inside
 * withTenantContext (RLS-correct), no outbox_events writes — so no
 * automation/notification side-effects. Look-and-feel data only.
 *
 * Run:
 *   pnpm exec dotenv -e .env.local -- tsx scripts/seed-secondary-workflows.ts
 */

import "dotenv/config";
import {
  withTenantContext,
  entityTypes,
  workflows,
  entityInstances,
  workflowEvents,
} from "@platform/db";
import { eq, and } from "drizzle-orm";

const DEV_TENANT_ID =
  process.env["DEV_TENANT_ID"] ?? "00000000-0000-0000-0000-000000000001";

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
];

const byId = new Map(USERS.map((u) => [u.id, u]));
function managerOf(userId: string): OrgUser | undefined {
  const u = byId.get(userId);
  return u?.managerId ? byId.get(u.managerId) : undefined;
}
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
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}
function daysFrom(base: Date, n: number): Date {
  return new Date(base.getTime() + n * 86_400_000);
}

const SALES = USERS.filter((u) => u.dept === "SALES");
const OPS_ENG = USERS.filter(
  (u) => u.dept === "OPERATIONS" || u.dept === "ENGINEERING",
);

const CUSTOMERS = [
  "Northern Railway Zone",
  "Indian Oil Corporation",
  "BHEL Trichy",
  "Steel Authority of India",
  "Rail Vikas Nigam",
  "GAIL India",
  "NTPC Vindhyachal",
  "Container Corporation of India",
  "Hindustan Aeronautics",
  "Coal India Ltd",
  "Metro Rail Bangalore",
  "DMRC Delhi Metro",
  "Bharat Heavy Electricals",
  "Power Grid Corporation",
  "ONGC Mumbai High",
];

const PRODUCTS = [
  "Signalling relay assemblies",
  "Track fastening systems",
  "Overhead traction components",
  "Coach interior fittings",
  "Braking system spares",
  "Axle bearing units",
  "Electrical control panels",
  "Hydraulic buffer assemblies",
  "Wagon coupling hardware",
  "Point machine assemblies",
];

// --- Workflow-specific generators -----------------------------------------

interface Section {
  entityTypeName: string;
  count: number;
  states: Array<[string, number]>;
  buildFields: (state: string, createdAt: Date) => Record<string, unknown>;
  pickOwner: () => OrgUser;
  dueDateFor: (fields: Record<string, unknown>, createdAt: Date) => Date | null;
  commentsFor: (state: string) => string[];
}

const salesTender: Section = {
  entityTypeName: "sales_tender_opportunity",
  count: 15,
  states: [
    ["intake", 12],
    ["qualification", 12],
    ["costing_in_progress", 10],
    ["quotation_prepared", 10],
    ["internal_approval_pending", 8],
    ["submitted", 10],
    ["followup", 10],
    ["negotiation", 8],
    ["won", 10],
    ["lost", 5],
    ["disqualified", 3],
    ["on_hold_dropped", 2],
  ],
  pickOwner: () => pick(SALES),
  buildFields: (state, createdAt) => {
    const intakeSource = pick([
      "cold_outreach",
      "tender_portal",
      "inbound_award",
    ]);
    const fields: Record<string, unknown> = {
      customer_name: pick(CUSTOMERS),
      intake_source: intakeSource,
      product_service_required: pick(PRODUCTS),
      enquiry_date: createdAt.toISOString().slice(0, 10),
    };
    if (intakeSource === "tender_portal") {
      fields["tender_portal"] = pick(["gem", "ireps", "cppp", "other"]);
      fields["tender_deadline"] = daysFrom(createdAt, 30)
        .toISOString()
        .slice(0, 10);
      fields["emd_amount"] = (Math.floor(Math.random() * 500) + 50) * 1000;
    } else {
      fields["lead_temperature"] = pick(["hot", "warm", "cold"]);
    }
    if (
      [
        "quotation_prepared",
        "internal_approval_pending",
        "submitted",
        "followup",
        "negotiation",
        "won",
        "lost",
      ].includes(state)
    ) {
      fields["quotation_amount"] =
        (Math.floor(Math.random() * 2000) + 200) * 1000;
      fields["costing_status"] = "done";
    }
    if (state === "won") fields["order_value"] = fields["quotation_amount"];
    if (state === "disqualified") fields["go_no_go_decision"] = "no_go";
    return fields;
  },
  dueDateFor: (fields, createdAt) =>
    typeof fields["tender_deadline"] === "string"
      ? new Date(fields["tender_deadline"])
      : daysFrom(createdAt, 21),
  commentsFor: (state) => {
    if (state === "disqualified")
      return ["Go/no-go review flagged eligibility gap — dropping this one."];
    if (state === "lost")
      return [
        "Lost to competitor on price.",
        "Debrief shared with sales lead.",
      ];
    if (state === "on_hold_dropped")
      return ["Customer paused budget approval — parking for now."];
    if (["followup", "negotiation", "submitted"].includes(state))
      return ["Following up with customer on quotation status."];
    return [];
  },
};

const orderFulfillment: Section = {
  entityTypeName: "order_fulfillment",
  count: 12,
  states: [
    ["so_entry", 12],
    ["so_approval", 12],
    ["compliance_milestones", 15],
    ["inspection_call_letter", 15],
    ["production", 15],
    ["dispatch", 12],
    ["document_handoff", 15],
    ["on_hold", 4],
  ],
  pickOwner: () => pick(OPS_ENG),
  buildFields: (state, createdAt) => {
    const fields: Record<string, unknown> = {
      customer_name: pick(CUSTOMERS),
      po_reference: `PO-${2026}-${1000 + Math.floor(Math.random() * 8999)}`,
      order_value: (Math.floor(Math.random() * 3000) + 300) * 1000,
    };
    if (
      [
        "so_approval",
        "compliance_milestones",
        "inspection_call_letter",
        "production",
        "dispatch",
        "document_handoff",
      ].includes(state)
    ) {
      fields["so_number"] = `SO-${3000 + Math.floor(Math.random() * 8999)}`;
    }
    if (
      [
        "inspection_call_letter",
        "production",
        "dispatch",
        "document_handoff",
      ].includes(state)
    ) {
      fields["call_letter_requested_date"] = daysFrom(createdAt, 10)
        .toISOString()
        .slice(0, 10);
      fields["inspection_date"] = daysFrom(createdAt, 20)
        .toISOString()
        .slice(0, 10);
    }
    if (["production", "dispatch", "document_handoff"].includes(state)) {
      fields["production_status"] =
        state === "production" ? "in_progress" : "complete";
    }
    if (["dispatch", "document_handoff"].includes(state)) {
      fields["dispatch_date"] = daysFrom(createdAt, 35)
        .toISOString()
        .slice(0, 10);
    }
    fields["delivery_timeline"] = daysFrom(createdAt, 45)
      .toISOString()
      .slice(0, 10);
    return fields;
  },
  dueDateFor: (fields) =>
    typeof fields["delivery_timeline"] === "string"
      ? new Date(fields["delivery_timeline"])
      : null,
  commentsFor: (state) => {
    if (state === "inspection_call_letter")
      return ["Awaiting railway inspection call letter — following up weekly."];
    if (state === "on_hold")
      return ["Customer requested hold pending internal budget review."];
    if (state === "document_handoff")
      return [
        "All dispatch documents shared with customer.",
        "Warranty certificate uploaded.",
      ];
    return [];
  },
};

const paymentFollowup: Section = {
  entityTypeName: "payment_followup",
  count: 12,
  states: [
    ["invoice_raised", 20],
    ["payment_due", 20],
    ["overdue_followup", 18],
    ["escalated", 8],
    ["paid", 25],
    ["disputed", 9],
  ],
  pickOwner: () => pick([...SALES, ...OPS_ENG]),
  buildFields: (state, createdAt) => {
    const invoiceAmount = (Math.floor(Math.random() * 800) + 50) * 1000;
    const dueDate = daysFrom(createdAt, 30);
    const fields: Record<string, unknown> = {
      customer_name: pick(CUSTOMERS),
      invoice_number: `INV-${2026}-${1000 + Math.floor(Math.random() * 8999)}`,
      invoice_amount: invoiceAmount,
      invoice_date: createdAt.toISOString().slice(0, 10),
      payment_due_date: dueDate.toISOString().slice(0, 10),
    };
    if (state === "paid") {
      fields["amount_received"] = invoiceAmount;
      fields["payment_received_date"] = daysFrom(dueDate, 3)
        .toISOString()
        .slice(0, 10);
    }
    if (state === "disputed") {
      fields["dispute_reason"] = pick([
        "Customer disputes freight charges included in invoice.",
        "Quantity mismatch flagged by customer's receiving team.",
        "Rate discrepancy vs purchase order terms.",
      ]);
    }
    return fields;
  },
  dueDateFor: (fields) =>
    typeof fields["payment_due_date"] === "string"
      ? new Date(fields["payment_due_date"])
      : null,
  commentsFor: (state) => {
    if (state === "overdue_followup")
      return ["Sent reminder email, awaiting response."];
    if (state === "escalated")
      return ["Escalated to account manager — no response after 2 reminders."];
    if (state === "disputed")
      return ["Customer raised a dispute, reviewing invoice details."];
    if (state === "paid") return ["Payment received and reconciled."];
    return [];
  },
};

const nsiAmendment: Section = {
  entityTypeName: "nsi_amendment_request",
  count: 10,
  states: [
    ["draft", 12],
    ["internal_review", 15],
    ["documents_pending", 10],
    ["ready_for_submission", 10],
    ["submitted_to_railway", 15],
    ["awaiting_railway_response", 15],
    ["clarification_requested", 8],
    ["approved", 10],
    ["rejected", 3],
    ["withdrawn", 2],
  ],
  pickOwner: () => pick(SALES),
  buildFields: (state, createdAt) => {
    const fields: Record<string, unknown> = {
      loa_reference_no: `LOA-${2025}-${1000 + Math.floor(Math.random() * 8999)}`,
      item_description: pick(PRODUCTS),
      quantity: Math.floor(Math.random() * 500) + 10,
      estimated_price: (Math.floor(Math.random() * 400) + 20) * 1000,
      justification:
        "Amendment required due to updated technical specification from end customer.",
    };
    if (
      [
        "submitted_to_railway",
        "awaiting_railway_response",
        "clarification_requested",
        "approved",
        "rejected",
      ].includes(state)
    ) {
      fields["railway_submission_date"] = daysFrom(createdAt, 15)
        .toISOString()
        .slice(0, 10);
    }
    if (state === "rejected") {
      fields["rejection_reason"] =
        "Railway zone cited non-compliance with revised vendor eligibility criteria.";
    }
    return fields;
  },
  dueDateFor: (fields, createdAt) =>
    typeof fields["railway_submission_date"] === "string"
      ? daysFrom(new Date(fields["railway_submission_date"] as string), 21)
      : daysFrom(createdAt, 30),
  commentsFor: (state) => {
    if (state === "clarification_requested")
      return ["Railway zone requested additional technical clarification."];
    if (state === "documents_pending")
      return ["Compliance docs pending from technical team."];
    if (state === "rejected")
      return ["Rejection reviewed with management — replanning approach."];
    if (state === "approved")
      return ["Amended LOA received from railway zone."];
    return [];
  },
};

const SECTIONS = [salesTender, orderFulfillment, paymentFollowup, nsiAmendment];

async function main(): Promise<void> {
  let totalCreated = 0;

  await withTenantContext(DEV_TENANT_ID, async (tx) => {
    for (const section of SECTIONS) {
      const [entityType] = await tx
        .select()
        .from(entityTypes)
        .where(
          and(
            eq(entityTypes.name, section.entityTypeName),
            eq(entityTypes.tenantId, DEV_TENANT_ID),
          ),
        )
        .limit(1);
      if (!entityType) {
        throw new Error(
          `Entity type '${section.entityTypeName}' not found — run its up.sql first.`,
        );
      }

      const [wf] = await tx
        .select()
        .from(workflows)
        .where(
          and(
            eq(workflows.entityTypeId, entityType.id),
            eq(workflows.tenantId, DEV_TENANT_ID),
          ),
        )
        .limit(1);
      if (!wf) {
        throw new Error(`Workflow for '${section.entityTypeName}' not found.`);
      }

      console.warn(
        `Seeding ${section.count} ${section.entityTypeName} record(s)...`,
      );

      for (let i = 0; i < section.count; i++) {
        const state = pickWeighted(section.states);
        const owner = section.pickOwner();
        const createdAt = daysAgo(Math.floor(Math.random() * 60));
        const fields = section.buildFields(state, createdAt);
        const dueDate = section.dueDateFor(fields, createdAt);

        const accessUsers: Record<string, { level: string; tag?: string }> = {};
        if (Math.random() < 0.25) {
          const mgr = managerOf(owner.id);
          if (mgr) accessUsers[mgr.id] = { level: "read_only" };
        }

        const [instance] = await tx
          .insert(entityInstances)
          .values({
            entityTypeId: entityType.id,
            tenantId: DEV_TENANT_ID,
            workflowId: wf.id,
            currentState: state,
            fields: {
              ...fields,
              ...(Object.keys(accessUsers).length > 0
                ? { __accessUsers: accessUsers }
                : {}),
            },
            createdBy: owner.id,
            assignedTo: owner.id,
            dueDate,
            createdAt,
            updatedAt: createdAt,
          })
          .returning({ id: entityInstances.id });
        if (!instance)
          throw new Error("entity_instances insert returned no row");
        const instanceId = instance.id;

        const initialStateEntry = section.states[0];
        if (!initialStateEntry) {
          throw new Error(
            `Section '${section.entityTypeName}' has no states configured`,
          );
        }
        const initialState = initialStateEntry[0];

        await tx.insert(workflowEvents).values({
          tenantId: DEV_TENANT_ID,
          instanceId,
          workflowId: wf.id,
          fromState: null,
          toState: initialState,
          triggeredBy: "seed",
          actorId: owner.id,
          createdAt,
        });

        const comments = section.commentsFor(state);
        let prevState = initialState;
        for (let c = 0; c < comments.length; c++) {
          const commentAt = daysFrom(createdAt, (c + 1) * 2);
          await tx.insert(workflowEvents).values({
            tenantId: DEV_TENANT_ID,
            instanceId,
            workflowId: wf.id,
            fromState: prevState,
            toState: state,
            triggeredBy: "seed",
            actorId: owner.id,
            comment: comments[c],
            metadata: { type: "comment", text: comments[c] },
            createdAt: commentAt,
          });
          prevState = state;
        }

        totalCreated++;
      }
    }
  });

  console.warn(
    `Seed complete — ${totalCreated} records created across 4 workflows.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
