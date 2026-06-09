/**
 * Tenant isolation tests for the view_configs table.
 *
 * view_configs is per-tenant UI configuration. RLS USING policy ensures
 * reads are scoped to the tenant set in app.tenant_id.
 *
 * Requires a live Postgres instance (run with docker compose up -d).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, withTenantContext } from "@platform/db";
import { viewConfigs } from "@platform/db";

// ── Test tenant IDs ───────────────────────────────────────────────────────────

const TENANT_A = "aaaaaaaa-3333-4000-a000-000000000001";
const TENANT_B = "bbbbbbbb-3333-4000-b000-000000000002";

// ── Shared state ──────────────────────────────────────────────────────────────

let configIdA: string;
let configIdB: string;

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  const [rowA] = await db
    .insert(viewConfigs)
    .values({
      tenantId: TENANT_A,
      entityTypeSlug: `ticket_isolation_${Date.now()}`,
      listColumns: [{ field: "subject", label: "Subject" }],
      detailLayout: [],
      formFieldOrder: ["subject"],
    })
    .returning();
  if (!rowA)
    throw new Error("setup: failed to insert view config for tenant A");
  configIdA = rowA.id;

  const [rowB] = await db
    .insert(viewConfigs)
    .values({
      tenantId: TENANT_B,
      entityTypeSlug: `ticket_isolation_b_${Date.now()}`,
      listColumns: [{ field: "title", label: "Title" }],
      detailLayout: [],
      formFieldOrder: ["title"],
    })
    .returning();
  if (!rowB)
    throw new Error("setup: failed to insert view config for tenant B");
  configIdB = rowB.id;
});

afterAll(async () => {
  await db.delete(viewConfigs).where(eq(viewConfigs.id, configIdA));
  await db.delete(viewConfigs).where(eq(viewConfigs.id, configIdB));
});

// ── READ isolation ────────────────────────────────────────────────────────────

describe("view_configs — cross-tenant READ isolation (RLS)", () => {
  it("Tenant A cannot read Tenant B view config via withTenantContext", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const rows = await tx
        .select({ id: viewConfigs.id })
        .from(viewConfigs)
        .where(eq(viewConfigs.id, configIdB));
      expect(rows).toHaveLength(0);
    });
  });

  it("Tenant B cannot read Tenant A view config via withTenantContext", async () => {
    await withTenantContext(TENANT_B, async (tx) => {
      const rows = await tx
        .select({ id: viewConfigs.id })
        .from(viewConfigs)
        .where(eq(viewConfigs.id, configIdA));
      expect(rows).toHaveLength(0);
    });
  });

  it("Tenant A can read its own view config", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const rows = await tx
        .select({ id: viewConfigs.id, tenantId: viewConfigs.tenantId })
        .from(viewConfigs)
        .where(eq(viewConfigs.id, configIdA));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.tenantId).toBe(TENANT_A);
    });
  });

  it("listing view configs as Tenant A returns only Tenant A configs", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const rows = await tx
        .select({ tenantId: viewConfigs.tenantId })
        .from(viewConfigs)
        .where(eq(viewConfigs.tenantId, TENANT_A));
      const ids = rows.map((r) => r.tenantId);
      expect(ids.every((id) => id === TENANT_A)).toBe(true);
    });
  });
});

// ── WRITE isolation ───────────────────────────────────────────────────────────

describe("view_configs — cross-tenant WRITE isolation (RLS WITH CHECK)", () => {
  it("Tenant A cannot insert a view config with Tenant B's tenantId via withTenantContext", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      // RLS WITH CHECK policy blocks INSERT where tenant_id ≠ app.tenant_id
      await expect(
        tx.insert(viewConfigs).values({
          tenantId: TENANT_B, // wrong tenant
          entityTypeSlug: `rls_write_test_${Date.now()}`,
          listColumns: [],
          detailLayout: [],
          formFieldOrder: [],
        }),
      ).rejects.toThrow();
    });
  });
});
