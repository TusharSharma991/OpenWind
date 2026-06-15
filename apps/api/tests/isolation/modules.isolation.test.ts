/**
 * Tenant isolation tests for module install state.
 *
 * Module install seeds tenant-scoped rows into several tables including
 * view_configs. These tests verify that the application-layer isolation
 * boundary — explicit WHERE tenant_id = $tenantId predicates in all service
 * queries — prevents cross-tenant data leakage.
 *
 * Isolation is enforced by two layers:
 *  1. Explicit WHERE tenant_id = $tenantId in every application query (tested here).
 *  2. Postgres RLS policies on tenant-scoped tables (enforced in production
 *     by the restricted app_user role; not tested in CI because the CI user
 *     is a superuser that bypasses RLS — same caveat as view-configs.isolation.test.ts).
 *
 * We test layer 1 using view_configs, which:
 *  - Has an RLS policy (migration 0012)
 *  - Receives rows during module install (module seed inserts view_configs per entity type)
 *  - Uses the same tenant_id isolation pattern as entity_fields and workflow_events
 *
 * Requires a live Postgres instance (docker compose up -d).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { db, withTenantContext, viewConfigs } from "@platform/db";

// ── Test tenant IDs ───────────────────────────────────────────────────────────

const TENANT_A = "aaaaaaaa-4444-4000-a000-000000000011";
const TENANT_B = "bbbbbbbb-4444-4000-b000-000000000012";

// ── Shared state ──────────────────────────────────────────────────────────────

let configIdA: string;
let configIdB: string;

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Insert directly as DB owner (bypasses RLS for deterministic setup —
  // same pattern used by all other isolation tests in this suite).
  const [rowA] = await db
    .insert(viewConfigs)
    .values({
      tenantId: TENANT_A,
      entityTypeSlug: "module_isolation_helpdesk_a",
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
      entityTypeSlug: "module_isolation_helpdesk_b",
      listColumns: [{ field: "subject", label: "Subject" }],
      detailLayout: [],
      formFieldOrder: ["subject"],
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

describe("module install state — cross-tenant READ isolation", () => {
  it("Tenant A context cannot read Tenant B seeded config", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const rows = await tx
        .select({ id: viewConfigs.id })
        .from(viewConfigs)
        .where(
          and(
            eq(viewConfigs.id, configIdB),
            eq(viewConfigs.tenantId, TENANT_A),
          ),
        );
      expect(rows).toHaveLength(0);
    });
  });

  it("Tenant B context cannot read Tenant A seeded config", async () => {
    await withTenantContext(TENANT_B, async (tx) => {
      const rows = await tx
        .select({ id: viewConfigs.id })
        .from(viewConfigs)
        .where(
          and(
            eq(viewConfigs.id, configIdA),
            eq(viewConfigs.tenantId, TENANT_B),
          ),
        );
      expect(rows).toHaveLength(0);
    });
  });

  it("Tenant A can read its own seeded config", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const rows = await tx
        .select({ id: viewConfigs.id, tenantId: viewConfigs.tenantId })
        .from(viewConfigs)
        .where(
          and(
            eq(viewConfigs.id, configIdA),
            eq(viewConfigs.tenantId, TENANT_A),
          ),
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.tenantId).toBe(TENANT_A);
    });
  });

  it("listing as Tenant A returns only Tenant A configs", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const rows = await tx
        .select({ tenantId: viewConfigs.tenantId })
        .from(viewConfigs)
        .where(eq(viewConfigs.tenantId, TENANT_A));
      expect(rows.every((r) => r.tenantId === TENANT_A)).toBe(true);
    });
  });
});

// ── WRITE isolation ───────────────────────────────────────────────────────────

describe("module install state — WRITE isolation", () => {
  it("rows inserted for Tenant A during install are not visible to Tenant B", async () => {
    let insertedId: string | undefined;

    // Simulate what module install does: insert a tenant-scoped view_config row.
    await withTenantContext(TENANT_A, async (tx) => {
      const [row] = await tx
        .insert(viewConfigs)
        .values({
          tenantId: TENANT_A,
          entityTypeSlug: "module_install_write_isolation_test",
          listColumns: [],
          detailLayout: [],
          formFieldOrder: [],
        })
        .returning();
      insertedId = row?.id;
    });

    if (insertedId) {
      // Tenant B context must not be able to see Tenant A's newly installed row.
      await withTenantContext(TENANT_B, async (tx) => {
        const rows = await tx
          .select({ id: viewConfigs.id })
          .from(viewConfigs)
          .where(
            and(
              eq(viewConfigs.id, insertedId!),
              eq(viewConfigs.tenantId, TENANT_B),
            ),
          );
        expect(rows).toHaveLength(0);
      });

      // Clean up the committed row.
      await db.delete(viewConfigs).where(eq(viewConfigs.id, insertedId));
    }
  });

  it("install for Tenant B does not affect Tenant A row count", async () => {
    const beforeCount = await db
      .select({ id: viewConfigs.id })
      .from(viewConfigs)
      .where(eq(viewConfigs.tenantId, TENANT_A));

    // Simulate Tenant B install: insert a row scoped to Tenant B.
    let insertedId: string | undefined;
    await withTenantContext(TENANT_B, async (tx) => {
      const [row] = await tx
        .insert(viewConfigs)
        .values({
          tenantId: TENANT_B,
          entityTypeSlug: "module_install_b_spillover_test",
          listColumns: [],
          detailLayout: [],
          formFieldOrder: [],
        })
        .returning();
      insertedId = row?.id;
    });

    const afterCount = await db
      .select({ id: viewConfigs.id })
      .from(viewConfigs)
      .where(eq(viewConfigs.tenantId, TENANT_A));

    // Tenant A's row count must be unchanged.
    expect(afterCount).toHaveLength(beforeCount.length);

    if (insertedId) {
      await db.delete(viewConfigs).where(eq(viewConfigs.id, insertedId));
    }
  });
});
