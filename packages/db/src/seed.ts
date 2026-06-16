import { db } from "./client.js";
import { tenants } from "./schema/index.js";

// Fixed UUID for the dev tenant — matches DEV_TENANT_ID in .env.local
const DEV_TENANT_ID = "00000000-0000-0000-0000-000000000001";

async function seed(): Promise<void> {
  console.warn("Seeding development data...");

  await db
    .insert(tenants)
    .values({
      id: DEV_TENANT_ID,
      name: "Demo Company",
      slug: "demo",
      plan: "standard",
    })
    .onConflictDoNothing();

  console.warn("Seed complete.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
