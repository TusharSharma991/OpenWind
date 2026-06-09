#!/usr/bin/env tsx
/**
 * seed-demo.ts
 *
 * Populates the dev tenant with a complete Helpdesk demo:
 *   • Helpdesk module registered in the modules table
 *   • "Support Ticket" entity type with 6 fields
 *   • "Ticket Lifecycle" workflow: 6 states, 8 transitions
 *   • 5 realistic ticket instances spread across different states
 *
 * Run after `pnpm db:seed`:
 *   pnpm seed:demo
 *
 * Safe to re-run — all inserts use onConflictDoNothing().
 */

import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, withTenantContext } from "@platform/db";
import {
  modules,
  tenants,
  entityTypes,
  entityFields,
  workflows,
  workflowStates,
  workflowTransitions,
  entityInstances,
} from "@platform/db";

// ─── Fixed IDs (deterministic = idempotent re-runs) ──────────────────────────

const DEV_TENANT_ID = "00000000-0000-0000-0000-000000000001";

const IDS = {
  module: "10000000-0000-0000-0000-000000000001",
  entityType: "20000000-0000-0000-0000-000000000001",
  workflow: "30000000-0000-0000-0000-000000000001",

  // States
  stateNew: "31000000-0000-0000-0000-000000000001",
  stateOpen: "31000000-0000-0000-0000-000000000002",
  stateProgress: "31000000-0000-0000-0000-000000000003",
  stateWaiting: "31000000-0000-0000-0000-000000000004",
  stateResolved: "31000000-0000-0000-0000-000000000005",
  stateClosed: "31000000-0000-0000-0000-000000000006",

  // Fields
  fieldSubject: "40000000-0000-0000-0000-000000000001",
  fieldDescription: "40000000-0000-0000-0000-000000000002",
  fieldPriority: "40000000-0000-0000-0000-000000000003",
  fieldCategory: "40000000-0000-0000-0000-000000000004",
  fieldCustomer: "40000000-0000-0000-0000-000000000005",
  fieldEmail: "40000000-0000-0000-0000-000000000006",

  // Transitions
  txNew2Open: "50000000-0000-0000-0000-000000000001",
  txOpen2Progress: "50000000-0000-0000-0000-000000000002",
  txProgress2Wait: "50000000-0000-0000-0000-000000000003",
  txWait2Progress: "50000000-0000-0000-0000-000000000004",
  txProgress2Done: "50000000-0000-0000-0000-000000000005",
  txDone2Closed: "50000000-0000-0000-0000-000000000006",
  txDone2Progress: "50000000-0000-0000-0000-000000000007",
  txOpen2Done: "50000000-0000-0000-0000-000000000008",

  // Instances
  ticket1: "60000000-0000-0000-0000-000000000001",
  ticket2: "60000000-0000-0000-0000-000000000002",
  ticket3: "60000000-0000-0000-0000-000000000003",
  ticket4: "60000000-0000-0000-0000-000000000004",
  ticket5: "60000000-0000-0000-0000-000000000005",
};

// ─── Seed ────────────────────────────────────────────────────────────────────

async function seed(): Promise<void> {
  console.log("🌱  Seeding Helpdesk demo data...\n");

  // 1. Module ─────────────────────────────────────────────────────────────────
  console.log("  📦  Module: Helpdesk");
  await db
    .insert(modules)
    .values({
      id: IDS.module,
      slug: "helpdesk",
      name: "Helpdesk",
      description: "Customer support ticket management with SLA tracking",
      version: "0.0.1",
      isSystem: false,
      minPlan: "standard",
    })
    .onConflictDoNothing();

  // 1b. Mark module as installed in tenant config ────────────────────────────
  const [tenantRow] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, DEV_TENANT_ID))
    .limit(1);
  const tenantConfig = (tenantRow?.config as Record<string, unknown>) ?? {};
  const installedMods: string[] = Array.isArray(
    tenantConfig["installed_modules"],
  )
    ? (tenantConfig["installed_modules"] as string[])
    : [];
  if (!installedMods.includes("helpdesk")) {
    installedMods.push("helpdesk");
    await db
      .update(tenants)
      .set({ config: { ...tenantConfig, installed_modules: installedMods } })
      .where(eq(tenants.id, DEV_TENANT_ID));
  }

  // 2. Entity Type ─────────────────────────────────────────────────────────────
  console.log("  🗂️   Entity type: Support Ticket");
  await db
    .insert(entityTypes)
    .values({
      id: IDS.entityType,
      tenantId: DEV_TENANT_ID,
      name: "Support Ticket",
      plural: "Support Tickets",
      icon: "🎫",
      moduleId: IDS.module,
      allowCustomFields: true,
    })
    .onConflictDoNothing();

  // 3. Fields — RLS-protected, must run inside withTenantContext
  console.log("  🔧  Fields (6)");
  await withTenantContext(DEV_TENANT_ID, async (tx) => {
    await tx
      .insert(entityFields)
      .values({
        id: IDS.fieldSubject,
        entityTypeId: IDS.entityType,
        tenantId: DEV_TENANT_ID,
        name: "subject",
        label: "Subject",
        fieldType: "text",
        isRequired: true,
        isIndexed: true,
        sortOrder: 0,
      })
      .onConflictDoNothing();

    await tx
      .insert(entityFields)
      .values({
        id: IDS.fieldDescription,
        entityTypeId: IDS.entityType,
        tenantId: DEV_TENANT_ID,
        name: "description",
        label: "Description",
        fieldType: "longtext",
        isRequired: false,
        sortOrder: 1,
      })
      .onConflictDoNothing();

    await tx
      .insert(entityFields)
      .values({
        id: IDS.fieldPriority,
        entityTypeId: IDS.entityType,
        tenantId: DEV_TENANT_ID,
        name: "priority",
        label: "Priority",
        fieldType: "enum",
        config: {
          options: [
            { value: "low", label: "Low", color: "#6b7280" },
            { value: "medium", label: "Medium", color: "#f59e0b" },
            { value: "high", label: "High", color: "#ef4444" },
            { value: "urgent", label: "Urgent", color: "#dc2626" },
          ],
        },
        isRequired: true,
        sortOrder: 2,
      })
      .onConflictDoNothing();

    await tx
      .insert(entityFields)
      .values({
        id: IDS.fieldCategory,
        entityTypeId: IDS.entityType,
        tenantId: DEV_TENANT_ID,
        name: "category",
        label: "Category",
        fieldType: "enum",
        config: {
          options: [
            { value: "billing", label: "Billing" },
            { value: "technical", label: "Technical" },
            { value: "general", label: "General" },
            { value: "feature_request", label: "Feature Request" },
          ],
        },
        isRequired: false,
        sortOrder: 3,
      })
      .onConflictDoNothing();

    await tx
      .insert(entityFields)
      .values({
        id: IDS.fieldCustomer,
        entityTypeId: IDS.entityType,
        tenantId: DEV_TENANT_ID,
        name: "customer_name",
        label: "Customer Name",
        fieldType: "text",
        isRequired: true,
        sortOrder: 4,
      })
      .onConflictDoNothing();

    await tx
      .insert(entityFields)
      .values({
        id: IDS.fieldEmail,
        entityTypeId: IDS.entityType,
        tenantId: DEV_TENANT_ID,
        name: "customer_email",
        label: "Customer Email",
        fieldType: "text",
        isRequired: false,
        sortOrder: 5,
      })
      .onConflictDoNothing();
  });

  // 4. Workflow ─────────────────────────────────────────────────────────────────
  console.log("  🔄  Workflow: Ticket Lifecycle");
  await db
    .insert(workflows)
    .values({
      id: IDS.workflow,
      tenantId: DEV_TENANT_ID,
      entityTypeId: IDS.entityType,
      name: "Ticket Lifecycle",
      initialState: "new",
    })
    .onConflictDoNothing();

  // 5. States ───────────────────────────────────────────────────────────────────
  console.log("  🔵  States (6)");
  await db
    .insert(workflowStates)
    .values([
      {
        id: IDS.stateNew,
        workflowId: IDS.workflow,
        name: "new",
        label: "New",
        color: "#6366f1",
        isTerminal: false,
        sortOrder: 0,
      },
      {
        id: IDS.stateOpen,
        workflowId: IDS.workflow,
        name: "open",
        label: "Open",
        color: "#3b82f6",
        isTerminal: false,
        sortOrder: 1,
      },
      {
        id: IDS.stateProgress,
        workflowId: IDS.workflow,
        name: "in_progress",
        label: "In Progress",
        color: "#f59e0b",
        isTerminal: false,
        slaHours: 24,
        sortOrder: 2,
      },
      {
        id: IDS.stateWaiting,
        workflowId: IDS.workflow,
        name: "waiting_for_customer",
        label: "Waiting for Customer",
        color: "#8b5cf6",
        isTerminal: false,
        sortOrder: 3,
      },
      {
        id: IDS.stateResolved,
        workflowId: IDS.workflow,
        name: "resolved",
        label: "Resolved",
        color: "#10b981",
        isTerminal: false,
        sortOrder: 4,
      },
      {
        id: IDS.stateClosed,
        workflowId: IDS.workflow,
        name: "closed",
        label: "Closed",
        color: "#6b7280",
        isTerminal: true,
        sortOrder: 5,
      },
    ])
    .onConflictDoNothing();

  // 6. Transitions ──────────────────────────────────────────────────────────────
  console.log("  ➡️   Transitions (8)");
  await db
    .insert(workflowTransitions)
    .values([
      {
        id: IDS.txNew2Open,
        workflowId: IDS.workflow,
        fromState: "new",
        toState: "open",
        label: "Assign",
        allowedRoles: ["admin", "agent"],
        requiresComment: false,
        requiresFields: [],
      },
      {
        id: IDS.txOpen2Progress,
        workflowId: IDS.workflow,
        fromState: "open",
        toState: "in_progress",
        label: "Start Working",
        allowedRoles: ["admin", "agent"],
        requiresComment: false,
        requiresFields: [],
      },
      {
        id: IDS.txProgress2Wait,
        workflowId: IDS.workflow,
        fromState: "in_progress",
        toState: "waiting_for_customer",
        label: "Need More Info",
        allowedRoles: ["admin", "agent"],
        requiresComment: true,
        requiresFields: [],
      },
      {
        id: IDS.txWait2Progress,
        workflowId: IDS.workflow,
        fromState: "waiting_for_customer",
        toState: "in_progress",
        label: "I've Responded",
        allowedRoles: ["admin", "agent", "user"],
        requiresComment: false,
        requiresFields: [],
      },
      {
        id: IDS.txProgress2Done,
        workflowId: IDS.workflow,
        fromState: "in_progress",
        toState: "resolved",
        label: "Mark Resolved",
        allowedRoles: ["admin", "agent"],
        requiresComment: true,
        requiresFields: [],
      },
      {
        id: IDS.txDone2Closed,
        workflowId: IDS.workflow,
        fromState: "resolved",
        toState: "closed",
        label: "Close Ticket",
        allowedRoles: ["admin", "agent", "user"],
        requiresComment: false,
        requiresFields: [],
      },
      {
        id: IDS.txDone2Progress,
        workflowId: IDS.workflow,
        fromState: "resolved",
        toState: "in_progress",
        label: "Reopen",
        allowedRoles: ["admin", "agent", "user"],
        requiresComment: true,
        requiresFields: [],
      },
      {
        id: IDS.txOpen2Done,
        workflowId: IDS.workflow,
        fromState: "open",
        toState: "resolved",
        label: "Quick Resolve",
        allowedRoles: ["admin", "agent"],
        requiresComment: true,
        requiresFields: [],
      },
    ])
    .onConflictDoNothing();

  // 7. Demo Ticket Instances — RLS-protected ───────────────────────────────────
  console.log("  🎫  Tickets (5)");
  await withTenantContext(DEV_TENANT_ID, async (tx) => {
    await tx
      .insert(entityInstances)
      .values([
        {
          id: IDS.ticket1,
          entityTypeId: IDS.entityType,
          tenantId: DEV_TENANT_ID,
          workflowId: IDS.workflow,
          currentState: "in_progress",
          fields: {
            subject: "Checkout button not working on mobile",
            description:
              "When tapping 'Proceed to payment' on iOS Safari the page just reloads. Happens every time with both Visa and Mastercard.",
            priority: "high",
            category: "technical",
            customer_name: "Priya Mehta",
            customer_email: "priya.mehta@example.com",
          },
        },
        {
          id: IDS.ticket2,
          entityTypeId: IDS.entityType,
          tenantId: DEV_TENANT_ID,
          workflowId: IDS.workflow,
          currentState: "waiting_for_customer",
          fields: {
            subject: "Need invoice for April subscription",
            description:
              "Hi, could you send me the invoice for April? I need it for my company's reimbursement claim by end of week.",
            priority: "medium",
            category: "billing",
            customer_name: "Carlos Rivera",
            customer_email: "carlos.r@startupxyz.io",
          },
        },
        {
          id: IDS.ticket3,
          entityTypeId: IDS.entityType,
          tenantId: DEV_TENANT_ID,
          workflowId: IDS.workflow,
          currentState: "open",
          fields: {
            subject: "Cannot log in — password reset not arriving",
            description:
              "I reset my password twice but the reset email never arrives. Checked spam folder. Account email is sarah@designco.com.",
            priority: "urgent",
            category: "technical",
            customer_name: "Sarah Kim",
            customer_email: "sarah@designco.com",
          },
        },
        {
          id: IDS.ticket4,
          entityTypeId: IDS.entityType,
          tenantId: DEV_TENANT_ID,
          workflowId: IDS.workflow,
          currentState: "new",
          fields: {
            subject: "Feature request: export records to CSV",
            description:
              "It would be very helpful to be able to export entity records to CSV for our weekly reporting. Happy to provide more details.",
            priority: "low",
            category: "feature_request",
            customer_name: "Tom Nguyen",
            customer_email: "tom.n@megacorp.com",
          },
        },
        {
          id: IDS.ticket5,
          entityTypeId: IDS.entityType,
          tenantId: DEV_TENANT_ID,
          workflowId: IDS.workflow,
          currentState: "resolved",
          fields: {
            subject: "Billing discrepancy — charged twice in March",
            description:
              "My card was charged twice on 15 March. Transaction IDs: TXN-8823 and TXN-8824. Please refund the duplicate.",
            priority: "medium",
            category: "billing",
            customer_name: "Amelia Johnson",
            customer_email: "amelia.j@gmail.com",
          },
        },
      ])
      .onConflictDoNothing();
  });

  console.log("\n✅  Demo seed complete!\n");
  console.log("  Module:       Helpdesk");
  console.log("  Entity type:  Support Ticket (6 fields)");
  console.log("  Workflow:     Ticket Lifecycle (6 states, 8 transitions)");
  console.log("  Tickets:      5 demo tickets across all states\n");
  console.log("  Open admin-ui → http://localhost:3001\n");

  process.exit(0);
}

seed().catch((err: unknown) => {
  console.error("Demo seed failed:", err);
  process.exit(1);
});
