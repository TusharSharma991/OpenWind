/**
 * Tenant + user isolation tests for the saved_views table.
 *
 * saved_views has a dual RLS policy — rows are visible only when BOTH
 * app.tenant_id AND app.user_id match.  These tests verify:
 *
 *   1. Cross-tenant read/write isolation  (Tenant A cannot see/mutate Tenant B rows)
 *   2. Cross-user isolation within a tenant  (User A cannot see/mutate User B rows
 *      even when they share the same tenant)
 *   3. WITH CHECK blocks a request that tries to INSERT a row with a user_id
 *      different from the authenticated user — this is the DB-layer proof that
 *      an API route cannot honour a user_id supplied in the request body.
 *
 * Tests run against a real Postgres instance (no mocks).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { db, withTenantAndUserContext } from "@platform/db";
import { savedViews, entityTypes } from "@platform/db";
import { createEntityType } from "@platform/entity-engine";
import type { EntityType } from "@platform/entity-engine";

// ── Fixed test identifiers ────────────────────────────────────────────────────
// Use UUIDs that are distinct from the entity-engine isolation suite constants.

const TENANT_A = "aaaaaaaa-2222-4000-a000-000000000011";
const TENANT_B = "bbbbbbbb-2222-4000-b000-000000000022";
const USER_A = "saved_views_isolation_user_a";
const USER_B = "saved_views_isolation_user_b";

// ── Shared fixtures seeded in beforeAll ───────────────────────────────────────

let entityType: EntityType;
let viewAId: string; // owned by TENANT_A / USER_A
let viewBId: string; // owned by TENANT_B / USER_B
let viewA2Id: string; // second TENANT_A / USER_A view (for default-toggle test)
let viewA_userBId: string; // TENANT_A / USER_B — for cross-user test within same tenant

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // System entity type (tenant_id = null) — satisfies the FK on saved_views.entity_type_id.
  entityType = await createEntityType(db, null, {
    name: `sv_isolation_type_${Date.now()}`,
    plural: "sv_isolation_types",
    allowCustomFields: false,
  });

  // Seed view rows directly — bypass the API route so we test pure RLS behaviour.
  // The db connection is the DB owner and bypasses RLS for setup/teardown only.
  const [rowA] = await db
    .insert(savedViews)
    .values({
      tenantId: TENANT_A,
      userId: USER_A,
      entityTypeId: entityType.id,
      name: "View A",
      filterConfig: { status: "open" },
      sortConfig: {},
      isDefault: false,
    })
    .returning({ id: savedViews.id });
  viewAId = rowA!.id;

  const [rowB] = await db
    .insert(savedViews)
    .values({
      tenantId: TENANT_B,
      userId: USER_B,
      entityTypeId: entityType.id,
      name: "View B",
      filterConfig: {},
      sortConfig: {},
      isDefault: false,
    })
    .returning({ id: savedViews.id });
  viewBId = rowB!.id;

  const [rowA2] = await db
    .insert(savedViews)
    .values({
      tenantId: TENANT_A,
      userId: USER_A,
      entityTypeId: entityType.id,
      name: "View A2",
      filterConfig: {},
      sortConfig: {},
      isDefault: true,
    })
    .returning({ id: savedViews.id });
  viewA2Id = rowA2!.id;

  // Same tenant as A, but different user — tests cross-user isolation within a tenant.
  const [rowAB] = await db
    .insert(savedViews)
    .values({
      tenantId: TENANT_A,
      userId: USER_B,
      entityTypeId: entityType.id,
      name: "User B's view in Tenant A",
      filterConfig: {},
      sortConfig: {},
      isDefault: false,
    })
    .returning({ id: savedViews.id });
  viewA_userBId = rowAB!.id;
});

afterAll(async () => {
  // The DB owner connection bypasses RLS — safe to delete test rows directly.
  await db.delete(savedViews).where(eq(savedViews.entityTypeId, entityType.id));
  await db.delete(entityTypes).where(eq(entityTypes.id, entityType.id));
});

// ── SELECT isolation ──────────────────────────────────────────────────────────

describe("SELECT — cross-tenant read isolation", () => {
  it("Tenant A / User A context returns zero rows owned by Tenant B", async () => {
    await withTenantAndUserContext(TENANT_A, USER_A, async (tx) => {
      const rows = await tx
        .select({ id: savedViews.id })
        .from(savedViews)
        .where(eq(savedViews.tenantId, TENANT_B));
      expect(rows).toHaveLength(0);
    });
  });

  it("Tenant A / User A context cannot fetch Tenant B's view by known id", async () => {
    await withTenantAndUserContext(TENANT_A, USER_A, async (tx) => {
      const rows = await tx
        .select({ id: savedViews.id })
        .from(savedViews)
        .where(eq(savedViews.id, viewBId));
      expect(rows).toHaveLength(0);
    });
  });

  it("Tenant A / User A context returns only their own views (not User B's in same tenant)", async () => {
    await withTenantAndUserContext(TENANT_A, USER_A, async (tx) => {
      const rows = await tx
        .select({ id: savedViews.id, userId: savedViews.userId })
        .from(savedViews)
        .where(eq(savedViews.tenantId, TENANT_A));
      // User B's view in Tenant A must not appear
      expect(rows.every((r) => r.userId === USER_A)).toBe(true);
      expect(rows.map((r) => r.id)).not.toContain(viewA_userBId);
    });
  });

  it("Tenant A / User A context cannot fetch User B's view (same tenant) by known id", async () => {
    await withTenantAndUserContext(TENANT_A, USER_A, async (tx) => {
      const rows = await tx
        .select({ id: savedViews.id })
        .from(savedViews)
        .where(eq(savedViews.id, viewA_userBId));
      expect(rows).toHaveLength(0);
    });
  });

  it("Tenant A / User A can read their own views", async () => {
    await withTenantAndUserContext(TENANT_A, USER_A, async (tx) => {
      const rows = await tx
        .select({ id: savedViews.id })
        .from(savedViews)
        .where(eq(savedViews.id, viewAId));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe(viewAId);
    });
  });
});

// ── INSERT isolation (WITH CHECK) ─────────────────────────────────────────────

describe("INSERT — WITH CHECK blocks mismatched tenant_id or user_id", () => {
  it("WITH CHECK rejects INSERT when tenant_id does not match context tenant", async () => {
    // Simulates an API route that tries to honour a tenant_id from the request body.
    await expect(
      withTenantAndUserContext(TENANT_A, USER_A, (tx) =>
        tx.insert(savedViews).values({
          tenantId: TENANT_B, // wrong — context is TENANT_A
          userId: USER_A,
          entityTypeId: entityType.id,
          name: "injection attempt",
          filterConfig: {},
          sortConfig: {},
          isDefault: false,
        }),
      ),
    ).rejects.toThrow();
  });

  it("WITH CHECK rejects INSERT when user_id does not match context user — proves POST body user_id is ignored", async () => {
    // This is the DB-layer proof that the API cannot accept a user_id from the
    // request body and store it: RLS WITH CHECK enforces user_id === app.user_id.
    await expect(
      withTenantAndUserContext(TENANT_A, USER_A, (tx) =>
        tx.insert(savedViews).values({
          tenantId: TENANT_A,
          userId: USER_B, // attacker supplies a different user_id
          entityTypeId: entityType.id,
          name: "user_id injection attempt",
          filterConfig: {},
          sortConfig: {},
          isDefault: false,
        }),
      ),
    ).rejects.toThrow();
  });

  it("INSERT succeeds when both tenant_id and user_id match context", async () => {
    let insertedId: string | undefined;
    await withTenantAndUserContext(TENANT_A, USER_A, async (tx) => {
      const [row] = await tx
        .insert(savedViews)
        .values({
          tenantId: TENANT_A,
          userId: USER_A,
          entityTypeId: entityType.id,
          name: "Valid insert",
          filterConfig: {},
          sortConfig: {},
          isDefault: false,
        })
        .returning({ id: savedViews.id });
      insertedId = row!.id;
      expect(insertedId).toBeTruthy();
    });

    // Cleanup the extra row
    if (insertedId) {
      await db.delete(savedViews).where(eq(savedViews.id, insertedId));
    }
  });
});

// ── UPDATE isolation ──────────────────────────────────────────────────────────

describe("UPDATE — cross-tenant and cross-user write isolation", () => {
  it("Tenant A / User A context cannot update Tenant B's view — zero rows affected", async () => {
    await withTenantAndUserContext(TENANT_A, USER_A, async (tx) => {
      const result = await tx
        .update(savedViews)
        .set({ name: "hacked" })
        .where(eq(savedViews.id, viewBId))
        .returning({ id: savedViews.id });
      expect(result).toHaveLength(0);
    });
  });

  it("Tenant B's view name is unchanged after Tenant A's failed update attempt", async () => {
    // Use db (owner connection, bypasses RLS) to verify the actual DB state.
    const rows = await db
      .select({ name: savedViews.name })
      .from(savedViews)
      .where(eq(savedViews.id, viewBId));
    expect(rows[0]?.name).toBe("View B");
  });

  it("Tenant A / User A context cannot update User B's view in the same tenant", async () => {
    await withTenantAndUserContext(TENANT_A, USER_A, async (tx) => {
      const result = await tx
        .update(savedViews)
        .set({ name: "user_b view hacked by user_a" })
        .where(eq(savedViews.id, viewA_userBId))
        .returning({ id: savedViews.id });
      expect(result).toHaveLength(0);
    });
  });

  it("Tenant A / User A can update their own view", async () => {
    await withTenantAndUserContext(TENANT_A, USER_A, async (tx) => {
      const result = await tx
        .update(savedViews)
        .set({ name: "View A (renamed)" })
        .where(eq(savedViews.id, viewAId))
        .returning({ id: savedViews.id, name: savedViews.name });
      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe("View A (renamed)");
    });
  });
});

// ── DELETE isolation ──────────────────────────────────────────────────────────

describe("DELETE — cross-tenant and cross-user delete isolation", () => {
  it("Tenant A / User A context cannot delete Tenant B's view — zero rows affected", async () => {
    await withTenantAndUserContext(TENANT_A, USER_A, async (tx) => {
      const result = await tx
        .delete(savedViews)
        .where(eq(savedViews.id, viewBId))
        .returning({ id: savedViews.id });
      expect(result).toHaveLength(0);
    });
  });

  it("Tenant B's view still exists after Tenant A's failed delete attempt", async () => {
    const rows = await db
      .select({ id: savedViews.id })
      .from(savedViews)
      .where(eq(savedViews.id, viewBId));
    expect(rows).toHaveLength(1);
  });

  it("Tenant A / User A context cannot delete User B's view in the same tenant", async () => {
    await withTenantAndUserContext(TENANT_A, USER_A, async (tx) => {
      const result = await tx
        .delete(savedViews)
        .where(eq(savedViews.id, viewA_userBId))
        .returning({ id: savedViews.id });
      expect(result).toHaveLength(0);
    });
  });

  it("User B's view in Tenant A is unaffected by User A's failed delete", async () => {
    const rows = await db
      .select({ id: savedViews.id })
      .from(savedViews)
      .where(eq(savedViews.id, viewA_userBId));
    expect(rows).toHaveLength(1);
  });
});

// ── is_default scoping ────────────────────────────────────────────────────────

describe("is_default — scoped per user, not per tenant", () => {
  it("User A's is_default flag is not visible to User B in the same tenant", async () => {
    // User A has viewA2 with is_default=true. User B in Tenant A should not see it.
    await withTenantAndUserContext(TENANT_A, USER_B, async (tx) => {
      const rows = await tx
        .select({ id: savedViews.id })
        .from(savedViews)
        .where(
          and(
            eq(savedViews.tenantId, TENANT_A),
            eq(savedViews.isDefault, true),
          ),
        );
      // User B has no default views — User A's default must not appear
      expect(rows.map((r) => r.id)).not.toContain(viewA2Id);
    });
  });

  it("User A sees their own default view when queried in their context", async () => {
    await withTenantAndUserContext(TENANT_A, USER_A, async (tx) => {
      const rows = await tx
        .select({ id: savedViews.id })
        .from(savedViews)
        .where(
          and(
            eq(savedViews.tenantId, TENANT_A),
            eq(savedViews.isDefault, true),
          ),
        );
      expect(rows.map((r) => r.id)).toContain(viewA2Id);
    });
  });
});
