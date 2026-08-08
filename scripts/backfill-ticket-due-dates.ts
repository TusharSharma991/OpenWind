#!/usr/bin/env tsx
/**
 * backfill-ticket-due-dates.ts
 *
 * The initial helpdesk ticket seed (scripts/seed-org-tickets.ts) didn't set
 * due_date. Backfills every ticket-entity row missing one, deriving a
 * plausible due date from its priority and created_at:
 *   urgent -> +1 day, high -> +3 days, medium -> +7 days, low -> +14 days
 * Resolved tickets keep the same offset (so some look completed-before-due,
 * some completed-late) rather than being special-cased to "on time".
 *
 * Run:
 *   pnpm exec dotenv -e .env.local -- tsx scripts/backfill-ticket-due-dates.ts
 */

import "dotenv/config";
import { withTenantContext, entityTypes, entityInstances } from "@platform/db";
import { eq, and, isNull } from "drizzle-orm";

const DEV_TENANT_ID =
  process.env["DEV_TENANT_ID"] ?? "00000000-0000-0000-0000-000000000001";

const PRIORITY_OFFSET_DAYS: Record<string, number> = {
  urgent: 1,
  high: 3,
  medium: 7,
  low: 14,
};

async function main(): Promise<void> {
  let updated = 0;

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
      throw new Error("No 'ticket' entity_type found for this tenant.");
    }

    const rows = await tx
      .select()
      .from(entityInstances)
      .where(
        and(
          eq(entityInstances.entityTypeId, ticketType.id),
          eq(entityInstances.tenantId, DEV_TENANT_ID),
          isNull(entityInstances.dueDate),
        ),
      );

    for (const row of rows) {
      const fields = row.fields as Record<string, unknown>;
      const priority =
        typeof fields["priority"] === "string" ? fields["priority"] : "medium";
      const offsetDays = PRIORITY_OFFSET_DAYS[priority] ?? 7;
      const dueDate = new Date(
        row.createdAt.getTime() + offsetDays * 86_400_000,
      );

      await tx
        .update(entityInstances)
        .set({ dueDate })
        .where(eq(entityInstances.id, row.id));
      updated++;
    }
  });

  console.warn(`Backfilled due_date on ${updated} ticket(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
