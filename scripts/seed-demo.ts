#!/usr/bin/env tsx
/**
 * seed-demo.ts
 *
 * Populates the modules registry so all templates appear on the Templates page.
 * Does NOT create any tenant-owned entity types, workflows, or records.
 * Users start with a clean slate and fork templates themselves.
 *
 * Run after `pnpm db:seed`:
 *   pnpm seed:demo
 *
 * Safe to re-run — all inserts use onConflictDoUpdate().
 */

import "dotenv/config";
import { db } from "@platform/db";
import { modules } from "@platform/db";

const TEMPLATES = [
  {
    slug: "helpdesk",
    name: "Helpdesk",
    description:
      "Support ticket management with priority, SLA, and category tracking",
    version: "0.0.1",
    isSystem: false,
    minPlan: "standard",
  },
  {
    slug: "crm",
    name: "CRM",
    description: "Sales pipeline and deal tracking from lead to close",
    version: "0.0.1",
    isSystem: false,
    minPlan: "standard",
  },
  {
    slug: "hrms",
    name: "HRMS",
    description: "Leave request and employee workflow management",
    version: "0.0.1",
    isSystem: false,
    minPlan: "standard",
  },
  {
    slug: "reimbursements",
    name: "Reimbursements",
    description: "Expense claim submission, approval, and payment tracking",
    version: "0.0.1",
    isSystem: false,
    minPlan: "standard",
  },
  {
    slug: "projects",
    name: "Projects",
    description:
      "Task and project tracking with backlog, sprint, and review stages",
    version: "0.0.1",
    isSystem: false,
    minPlan: "standard",
  },
  {
    slug: "invoicing",
    name: "Invoicing",
    description: "Invoice lifecycle from draft through sent, viewed, to paid",
    version: "0.0.1",
    isSystem: false,
    minPlan: "standard",
  },
  {
    slug: "procurement",
    name: "Procurement",
    description: "Purchase order requests, approvals, and delivery tracking",
    version: "0.0.1",
    isSystem: false,
    minPlan: "standard",
  },
];

async function seed(): Promise<void> {
  console.log("🌱  Seeding module template registry...\n");

  for (const template of TEMPLATES) {
    await db
      .insert(modules)
      .values(template)
      .onConflictDoUpdate({
        target: modules.slug,
        set: {
          name: template.name,
          description: template.description,
          version: template.version,
          updatedAt: new Date(),
        },
      });
    console.log(`  ✓  ${template.name}`);
  }

  console.log("\n✅  Template registry seeded!\n");
  console.log(
    `  ${TEMPLATES.length} templates available on the Templates page.`,
  );
  console.log(
    "  Users start with a clean slate — fork any template to begin.\n",
  );
  console.log("  Open admin-ui → http://localhost:3001\n");

  process.exit(0);
}

seed().catch((err: unknown) => {
  console.error("Template registry seed failed:", err);
  process.exit(1);
});
