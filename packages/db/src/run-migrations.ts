// This is a standalone CLI script — direct process.env access is intentional
// (it cannot use @platform/config which requires all app env vars).
/* eslint-disable no-restricted-syntax */

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import path from "path";
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Load .env.local from the monorepo root (walk up from cwd/dirname until we find it)
function findEnvLocal(): string | undefined {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, ".env.local");
    if (existsSync(candidate)) return candidate;
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

const envLocalPath = findEnvLocal();
if (envLocalPath) {
  loadDotenv({ path: envLocalPath, override: false });
}

const migrationsFolder = path.join(__dirname, "../migrations");

async function main(): Promise<void> {
  const url =
    process.env["MIGRATION_DATABASE_URL"] ?? process.env["DATABASE_URL"];
  if (!url) {
    console.error("DATABASE_URL or MIGRATION_DATABASE_URL is not set");
    process.exit(1);
  }

  const client = postgres(url, { max: 1 });
  const db = drizzle(client);

  console.error("Running migrations from:", migrationsFolder);

  try {
    await migrate(db, { migrationsFolder });
    console.error("All migrations applied successfully.");
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

void main();
