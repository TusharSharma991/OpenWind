#!/usr/bin/env tsx
/**
 * check-analytics-annotations.ts
 *
 * CI lint rule: every migration file that contains a CREATE TABLE statement
 * must include an `-- analytics:` annotation line declaring whether
 * analytics_user should have access to that table.
 *
 * Valid annotations:
 *   -- analytics: excluded (reason why analytics_user cannot access this table)
 *   -- analytics: included(col1, col2, col3)
 *
 * Exit 1 if any violation is found; exit 0 if all files are compliant.
 *
 * Usage:
 *   pnpm check-analytics-annotations
 *   tsx scripts/check-analytics-annotations.ts
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "packages", "db", "migrations");

// Matches CREATE TABLE (case-insensitive, with optional IF NOT EXISTS)
const CREATE_TABLE_RE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/i;

// Matches the required annotation comment anywhere in the file
const ANNOTATION_RE = /--\s+analytics\s*:/i;

function log(msg: string): void {
  console.log(`[check-analytics] ${msg}`);
}

function fail(msg: string): never {
  console.error(`[check-analytics] FAIL: ${msg}`);
  process.exit(1);
}

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

let violationCount = 0;

for (const file of files) {
  const filePath = join(MIGRATIONS_DIR, file);
  const content = readFileSync(filePath, "utf8");

  if (!CREATE_TABLE_RE.test(content)) {
    // No CREATE TABLE in this file — no annotation required
    continue;
  }

  if (!ANNOTATION_RE.test(content)) {
    console.error(
      `[check-analytics] MISSING ANNOTATION: ${file}\n` +
        `  This migration contains CREATE TABLE but is missing an analytics annotation.\n` +
        `  Add one of the following comment lines to the file:\n` +
        `    -- analytics: excluded (reason)\n` +
        `    -- analytics: included(col1, col2, ...)\n` +
        `  See ADR-001 (Analytics Access Policy addendum) for the convention.`,
    );
    violationCount++;
  }
}

if (violationCount > 0) {
  fail(
    `${violationCount} migration file(s) missing -- analytics: annotation. See errors above.`,
  );
}

log(
  `All ${files.length} migration files checked — ${violationCount === 0 ? "OK" : `${violationCount} violation(s)`}.`,
);
