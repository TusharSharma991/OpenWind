/**
 * R13 (docs/specs/multi-org-sandbox.md), migration 0156. Real Postgres: the platform admin may
 * read a sandbox's slug (for the login link) and still nothing else beyond the columns granted in
 * 0135, 0144 and 0155. The grant is a database property, so it is tested against the database.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, tenants, withPlatformAdminContext } from "@platform/db";

const SANDBOX_TENANT = "eeeeeeee-0156-4000-e000-000000000156";
const SLUG = `r13-grant-${Date.now()}`;

// Drizzle wraps the driver error; the Postgres message is on `cause`.
function errorText(err: unknown): string {
  const cause = (err as { cause?: unknown }).cause;
  return `${String(err)} ${cause instanceof Error ? cause.message : ""}`;
}

beforeAll(async () => {
  await db
    .insert(tenants)
    .values({
      id: SANDBOX_TENANT,
      name: "R13 grant sandbox",
      slug: SLUG,
      isSandbox: true,
    })
    .onConflictDoNothing();
});

afterAll(async () => {
  await db.delete(tenants).where(eq(tenants.id, SANDBOX_TENANT));
});

describe("platform_admin_role and tenants.slug (login-branding, R13)", () => {
  it("can read a sandbox's slug", async () => {
    const [row] = await withPlatformAdminContext((tx) =>
      tx
        .select({ slug: tenants.slug })
        .from(tenants)
        .where(eq(tenants.id, SANDBOX_TENANT)),
    );

    expect(row?.slug).toBe(SLUG);
  });

  it.each([
    [
      "config",
      sql`SELECT config FROM tenants WHERE id = ${SANDBOX_TENANT}::uuid`,
    ],
    ["plan", sql`SELECT plan FROM tenants WHERE id = ${SANDBOX_TENANT}::uuid`],
    [
      "zitadel_org_id",
      sql`SELECT zitadel_org_id FROM tenants WHERE id = ${SANDBOX_TENANT}::uuid`,
    ],
  ])("still cannot read tenants.%s", async (_column, query) => {
    let caught: unknown;
    try {
      await withPlatformAdminContext((tx) => tx.execute(query));
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(errorText(caught)).toMatch(/permission denied/);
  });

  it("still has no UPDATE on the slug, so a handed-over link cannot be changed from here", async () => {
    let caught: unknown;
    try {
      await withPlatformAdminContext((tx) =>
        tx
          .update(tenants)
          .set({ slug: `${SLUG}-changed` })
          .where(eq(tenants.id, SANDBOX_TENANT)),
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(errorText(caught)).toMatch(/permission denied/);
    const [row] = await db
      .select({ slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.id, SANDBOX_TENANT));
    expect(row?.slug).toBe(SLUG);
  });
});
