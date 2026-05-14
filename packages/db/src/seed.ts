import { db } from "./client.js";
import { tenants } from "./schema/index.js";

async function seed(): Promise<void> {
  console.log("Seeding development data...");

  await db
    .insert(tenants)
    .values({
      name: "Demo Company",
      slug: "demo",
      plan: "standard",
    })
    .onConflictDoNothing();

  console.log("Seed complete.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
