/**
 * Tenant isolation tests for the entity_links table (title/URL reference
 * links attached to a ticket — record-detail Links tab).
 *
 * Isolation is enforced by two layers:
 *  1. Explicit WHERE tenant_id = $tenantId in every query (tested here).
 *  2. Postgres RLS policy (migration 0063) — exercised here via
 *     withTenantContext, which runs under SET LOCAL ROLE app_user, so a
 *     query that omits the tenant_id predicate is still blocked by RLS.
 *
 * Requires a live Postgres instance (run with docker compose up -d).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { db, withTenantContext } from "@platform/db";
import { entityLinks } from "@platform/db";

const TENANT_A = "cccccccc-1111-4000-c000-000000000001";
const TENANT_B = "dddddddd-1111-4000-d000-000000000002";
const USER_A = "cccccccc-1111-4000-c000-000000000010";
const USER_B = "dddddddd-1111-4000-d000-000000000020";
const ENTITY_A = "cccccccc-1111-4000-c000-000000000030";
const ENTITY_B = "dddddddd-1111-4000-d000-000000000040";

let linkIdA: string;
let linkIdB: string;

beforeAll(async () => {
  const [rowA] = await db
    .insert(entityLinks)
    .values({
      tenantId: TENANT_A,
      entityId: ENTITY_A,
      title: "Tenant A doc",
      url: "https://example.com/tenant-a",
      createdBy: USER_A,
    })
    .returning();
  if (!rowA) throw new Error("setup: failed to insert link for tenant A");
  linkIdA = rowA.id;

  const [rowB] = await db
    .insert(entityLinks)
    .values({
      tenantId: TENANT_B,
      entityId: ENTITY_B,
      title: "Tenant B doc",
      url: "https://example.com/tenant-b",
      createdBy: USER_B,
    })
    .returning();
  if (!rowB) throw new Error("setup: failed to insert link for tenant B");
  linkIdB = rowB.id;
});

afterAll(async () => {
  await db.delete(entityLinks).where(eq(entityLinks.tenantId, TENANT_A));
  await db.delete(entityLinks).where(eq(entityLinks.tenantId, TENANT_B));
});

describe("entity_links — cross-tenant READ isolation", () => {
  it("query scoped to Tenant A returns nothing for Tenant B link ID", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const rows = await tx
        .select({ id: entityLinks.id })
        .from(entityLinks)
        .where(
          and(eq(entityLinks.id, linkIdB), eq(entityLinks.tenantId, TENANT_A)),
        );
      expect(rows).toHaveLength(0);
    });
  });

  it("query scoped to Tenant B returns nothing for Tenant A link ID", async () => {
    await withTenantContext(TENANT_B, async (tx) => {
      const rows = await tx
        .select({ id: entityLinks.id })
        .from(entityLinks)
        .where(
          and(eq(entityLinks.id, linkIdA), eq(entityLinks.tenantId, TENANT_B)),
        );
      expect(rows).toHaveLength(0);
    });
  });

  it("Tenant A can read its own link rows", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const rows = await tx
        .select({ id: entityLinks.id, tenantId: entityLinks.tenantId })
        .from(entityLinks)
        .where(
          and(eq(entityLinks.id, linkIdA), eq(entityLinks.tenantId, TENANT_A)),
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.tenantId).toBe(TENANT_A);
    });
  });

  // RLS (layer 2) — a query with no tenant_id predicate at all, run under
  // Tenant A's context, must still not see Tenant B's row (relying purely on
  // set_config('app.tenant_id', ...) + the policy, not the app-level filter).
  it("RLS alone blocks a cross-tenant row even with no explicit tenant_id filter", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const rows = await tx
        .select({ id: entityLinks.id })
        .from(entityLinks)
        .where(eq(entityLinks.id, linkIdB));
      expect(rows).toHaveLength(0);
    });
  });
});

describe("entity_links — cross-tenant DELETE isolation", () => {
  it("Tenant A delete scoped by tenant_id does not remove Tenant B's link", async () => {
    await withTenantContext(TENANT_A, (tx) =>
      tx
        .delete(entityLinks)
        .where(
          and(eq(entityLinks.id, linkIdB), eq(entityLinks.tenantId, TENANT_A)),
        ),
    );

    const [stillThere] = await db
      .select({ id: entityLinks.id })
      .from(entityLinks)
      .where(eq(entityLinks.id, linkIdB));
    expect(stillThere?.id).toBe(linkIdB);
  });
});
