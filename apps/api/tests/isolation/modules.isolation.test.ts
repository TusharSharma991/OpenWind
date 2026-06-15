/**
 * Tenant isolation tests for module install state.
 *
 * The `modules` table is a platform-global registry (no tenant_id) and is
 * intentionally not tenant-scoped — any authenticated user may list modules.
 * Isolation applies to module *install state*, which lives in tenants.config
 * and is scoped by tenant_id. These tests verify:
 *
 *  1. A tenant's install list is only visible under their own tenant context.
 *  2. Installing a module for Tenant A does not affect Tenant B's config.
 *  3. All config reads and writes go through withTenantContext so the
 *     explicit WHERE tenant_id = $tenantId predicate is always applied.
 *
 * Requires a live Postgres instance (docker compose up -d).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, withTenantContext, tenants } from "@platform/db";

// ── Test tenant IDs ───────────────────────────────────────────────────────────

const TENANT_A = "aaaaaaaa-4444-4000-a000-000000000011";
const TENANT_B = "bbbbbbbb-4444-4000-b000-000000000012";

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await db
    .insert(tenants)
    .values([
      {
        id: TENANT_A,
        name: "Isolation Test Tenant A (modules)",
        plan: "standard",
        config: { installed_modules: ["crm"] },
      },
      {
        id: TENANT_B,
        name: "Isolation Test Tenant B (modules)",
        plan: "standard",
        config: { installed_modules: [] },
      },
    ])
    .onConflictDoNothing();
});

afterAll(async () => {
  await db.delete(tenants).where(eq(tenants.id, TENANT_A));
  await db.delete(tenants).where(eq(tenants.id, TENANT_B));
});

// ── READ isolation ────────────────────────────────────────────────────────────

describe("modules install state — cross-tenant READ isolation", () => {
  it("Tenant A context returns only Tenant A config", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const rows = await tx
        .select({ id: tenants.id, config: tenants.config })
        .from(tenants)
        .where(eq(tenants.id, TENANT_A));
      expect(rows).toHaveLength(1);
      const config = rows[0]?.config as Record<string, unknown>;
      expect((config.installed_modules as string[]).includes("crm")).toBe(true);
    });
  });

  it("Tenant A context returns nothing when querying Tenant B tenant_id", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const rows = await tx
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.id, TENANT_B));
      // Application layer enforces explicit tenant_id on all reads;
      // no cross-tenant row should be reachable via the service layer.
      // This test uses the raw Drizzle query to prove the WHERE predicate
      // is applied — production code always adds eq(tenants.id, tenantId).
      expect(rows).toHaveLength(0);
    });
  });

  it("Tenant B install list is empty and unaffected by Tenant A installs", async () => {
    await withTenantContext(TENANT_B, async (tx) => {
      const rows = await tx
        .select({ config: tenants.config })
        .from(tenants)
        .where(eq(tenants.id, TENANT_B));
      expect(rows).toHaveLength(1);
      const config = rows[0]?.config as Record<string, unknown>;
      expect(config.installed_modules).toEqual([]);
    });
  });
});

// ── WRITE isolation ───────────────────────────────────────────────────────────

describe("modules install state — WRITE isolation", () => {
  it("updating Tenant A config does not affect Tenant B config", async () => {
    // Simulate an install: append 'helpdesk' to Tenant A's install list
    await withTenantContext(TENANT_A, async (tx) => {
      await tx
        .update(tenants)
        .set({ config: { installed_modules: ["crm", "helpdesk"] } })
        .where(eq(tenants.id, TENANT_A));
    });

    // Tenant B should still have an empty install list
    const [tenantB] = await db
      .select({ config: tenants.config })
      .from(tenants)
      .where(eq(tenants.id, TENANT_B));
    const configB = tenantB?.config as Record<string, unknown>;
    expect(configB.installed_modules).toEqual([]);
  });

  it("config write is scoped to the exact tenant — row count for other tenant unchanged", async () => {
    let updatedCount = 0;
    await withTenantContext(TENANT_B, async (tx) => {
      const result = await tx
        .update(tenants)
        .set({ config: { installed_modules: ["projects"] } })
        .where(eq(tenants.id, TENANT_B))
        .returning({ id: tenants.id });
      updatedCount = result.length;
    });
    // Exactly one row updated — not both tenants
    expect(updatedCount).toBe(1);

    // Tenant A's config is untouched
    const [tenantA] = await db
      .select({ config: tenants.config })
      .from(tenants)
      .where(eq(tenants.id, TENANT_A));
    const configA = tenantA?.config as Record<string, unknown>;
    expect((configA.installed_modules as string[]).includes("projects")).toBe(
      false,
    );
  });
});
