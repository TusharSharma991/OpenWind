#!/usr/bin/env tsx
/**
 * reset-data.ts
 *
 * Truncates all workflow + entity data for the dev tenant, leaving the
 * tenant row, tenant users, and module registry intact.
 *
 * Run:
 *   pnpm exec dotenv -e .env.local -- tsx scripts/reset-data.ts
 */

import "dotenv/config";
import { db, withTenantContext } from "@platform/db";
import {
  entityInstances,
  entityRelations,
  entityFields,
  entityTypes,
  workflowEvents,
  workflowTransitions,
  workflowStates,
  workflows,
  modules,
} from "@platform/db";

const DEV_TENANT_ID = "00000000-0000-0000-0000-000000000001";

async function reset(): Promise<void> {
  console.log("🗑️  Resetting data (keeping tenant + users)...\n");

  // RLS-protected tables need tenant context
  await withTenantContext(DEV_TENANT_ID, async (tx) => {
    await tx.delete(workflowEvents);
    console.log("  ✓ workflow_events cleared");

    await tx.delete(entityRelations);
    console.log("  ✓ entity_relations cleared");

    await tx.delete(entityInstances);
    console.log("  ✓ entity_instances cleared");

    await tx.delete(workflowTransitions);
    console.log("  ✓ workflow_transitions cleared");

    await tx.delete(workflowStates);
    console.log("  ✓ workflow_states cleared");

    await tx.delete(workflows);
    console.log("  ✓ workflows cleared");

    await tx.delete(entityFields);
    console.log("  ✓ entity_fields cleared");

    await tx.delete(entityTypes);
    console.log("  ✓ entity_types cleared");
  });

  // modules table has no RLS (global registry)
  await db.delete(modules);
  console.log("  ✓ modules cleared");

  console.log("\n✅  Reset complete — clean slate ready.\n");
  process.exit(0);
}

reset().catch((err: unknown) => {
  console.error("Reset failed:", err);
  process.exit(1);
});
