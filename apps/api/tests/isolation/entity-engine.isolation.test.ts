/**
 * Tenant isolation tests for the entity engine.
 *
 * These tests use a real Postgres database (no mocks) to verify that cross-tenant
 * data leakage is impossible across every public entity engine API surface.
 * Two isolated test tenants (A and B) are created per suite run and torn down
 * after all tests complete.
 *
 * Isolation is enforced by two layers:
 *  1. Explicit WHERE tenant_id = $tenantId conditions in every engine query.
 *  2. Postgres RLS policies (when the connection role has RLS enforced).
 *
 * These tests exercise layer 1 exhaustively and exercise layer 2 via
 * withTenantContext, which sets app.tenant_id for the transaction.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { db, withTenantContext } from "@platform/db";
import { entityInstances, entityTypes, entityRelations } from "@platform/db";
import {
  createEntityType,
  createEntity,
  getEntity,
  updateEntity,
  deleteEntity,
  listEntities,
  createRelation,
  listRelations,
  searchEntities,
  EntityError,
} from "@platform/entity-engine";
import type { EntityType, EntityInstance } from "@platform/entity-engine";

// ── Test tenant IDs — UUIDs that will never collide with real data ────────────

const TENANT_A = "aaaaaaaa-0000-4000-a000-000000000001";
const TENANT_B = "bbbbbbbb-0000-4000-b000-000000000002";

// ── Shared state seeded in beforeAll ─────────────────────────────────────────

let entityType: EntityType;
let instanceA: EntityInstance;
let instanceB: EntityInstance;
let instanceA2: EntityInstance; // second A instance for list/relation tests

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // System entity type (tenant_id = null) — shared across all tenants.
  // entity_types has no RLS so this can use the global db directly.
  entityType = await createEntityType(db, null, {
    name: `isolation_ticket_${Date.now()}`,
    plural: "isolation_tickets",
    allowCustomFields: true,
  });

  // Seed Tenant A instances
  instanceA = await withTenantContext(TENANT_A, (tx) =>
    createEntity(tx, TENANT_A, {
      entityTypeId: entityType.id,
      fields: {},
    }),
  );

  instanceA2 = await withTenantContext(TENANT_A, (tx) =>
    createEntity(tx, TENANT_A, {
      entityTypeId: entityType.id,
      fields: {},
    }),
  );

  // Seed Tenant B instance
  instanceB = await withTenantContext(TENANT_B, (tx) =>
    createEntity(tx, TENANT_B, {
      entityTypeId: entityType.id,
      fields: {},
    }),
  );
});

afterAll(async () => {
  // Clean up in FK dependency order.
  // The platform user is the DB owner and bypasses RLS for cleanup.
  await db
    .delete(entityRelations)
    .where(eq(entityRelations.tenantId, TENANT_A));
  await db
    .delete(entityRelations)
    .where(eq(entityRelations.tenantId, TENANT_B));
  await db
    .delete(entityInstances)
    .where(eq(entityInstances.entityTypeId, entityType.id));
  await db.delete(entityTypes).where(eq(entityTypes.id, entityType.id));
});

// ── GET isolation ─────────────────────────────────────────────────────────────

describe("getEntity — cross-tenant read isolation", () => {
  it("returns EntityError (not Tenant B data) when Tenant A reads Tenant B instance ID", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      await expect(
        getEntity(tx, TENANT_A, instanceB.id),
      ).rejects.toBeInstanceOf(EntityError);
    });
  });

  it("Tenant A can read its own instance", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const result = await getEntity(tx, TENANT_A, instanceA.id);
      expect(result.id).toBe(instanceA.id);
      expect(result.tenantId).toBe(TENANT_A);
    });
  });

  it("returns 404-equivalent error, not a 403 (existence must not be leaked)", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const err = await getEntity(tx, TENANT_A, instanceB.id).catch((e) => e);
      expect(err).toBeInstanceOf(EntityError);
      // ENTITY_NOT_FOUND — same error as a genuinely missing resource
      expect((err as EntityError).code).toBe("ENTITY_NOT_FOUND");
    });
  });
});

// ── UPDATE isolation ──────────────────────────────────────────────────────────

describe("updateEntity — cross-tenant write isolation", () => {
  it("throws EntityError when Tenant A updates Tenant B instance", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      await expect(
        updateEntity(tx, TENANT_A, instanceB.id, {
          fields: { note: "hacked" },
        }),
      ).rejects.toBeInstanceOf(EntityError);
    });
  });

  it("Tenant A can update its own instance", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const result = await updateEntity(tx, TENANT_A, instanceA.id, {
        fields: {},
      });
      expect(result.id).toBe(instanceA.id);
    });
  });
});

// ── DELETE isolation ──────────────────────────────────────────────────────────

describe("deleteEntity — cross-tenant delete isolation", () => {
  it("throws EntityError when Tenant A soft-deletes Tenant B instance", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      await expect(
        deleteEntity(tx, TENANT_A, instanceB.id),
      ).rejects.toBeInstanceOf(EntityError);
    });
  });

  it("Tenant B instance is not deleted after Tenant A's failed attempt", async () => {
    await withTenantContext(TENANT_B, async (tx) => {
      const result = await getEntity(tx, TENANT_B, instanceB.id);
      expect(result.deletedAt).toBeNull();
    });
  });
});

// ── LIST isolation ────────────────────────────────────────────────────────────

describe("listEntities — cross-tenant list isolation", () => {
  it("Tenant A list returns zero Tenant B instances", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const page = await listEntities(tx, TENANT_A, {
        entityTypeId: entityType.id,
      });
      const tenantBRows = page.data.filter((i) => i.tenantId === TENANT_B);
      expect(tenantBRows).toHaveLength(0);
    });
  });

  it("Tenant A list contains only Tenant A instances", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const page = await listEntities(tx, TENANT_A, {
        entityTypeId: entityType.id,
      });
      expect(page.data.length).toBeGreaterThan(0);
      expect(page.data.every((i) => i.tenantId === TENANT_A)).toBe(true);
    });
  });

  it("Tenant B list does not include Tenant A instances", async () => {
    await withTenantContext(TENANT_B, async (tx) => {
      const page = await listEntities(tx, TENANT_B, {
        entityTypeId: entityType.id,
      });
      const tenantARows = page.data.filter((i) => i.tenantId === TENANT_A);
      expect(tenantARows).toHaveLength(0);
    });
  });
});

// ── RELATIONS isolation ───────────────────────────────────────────────────────

describe("createRelation — cross-tenant relation isolation", () => {
  it("throws RELATION_TARGET_NOT_FOUND when Tenant A links to Tenant B instance", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const err = await createRelation(tx, TENANT_A, {
        fromInstanceId: instanceA.id,
        toInstanceId: instanceB.id,
        relationType: "isolation_test",
      }).catch((e) => e);
      expect(err).toBeInstanceOf(EntityError);
      expect((err as EntityError).code).toBe("RELATION_TARGET_NOT_FOUND");
    });
  });

  it("throws RELATION_TARGET_NOT_FOUND when from-instance belongs to Tenant B", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      await expect(
        createRelation(tx, TENANT_A, {
          fromInstanceId: instanceB.id,
          toInstanceId: instanceA.id,
          relationType: "isolation_test",
        }),
      ).rejects.toBeInstanceOf(EntityError);
    });
  });

  it("Tenant A can create a relation between its own instances", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const rel = await createRelation(tx, TENANT_A, {
        fromInstanceId: instanceA.id,
        toInstanceId: instanceA2.id,
        relationType: "sibling",
      });
      expect(rel.tenantId).toBe(TENANT_A);
    });
  });
});

describe("listRelations — cross-tenant list isolation", () => {
  it("Tenant A cannot list Tenant B relations by passing Tenant B instance ID", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const page = await listRelations(tx, TENANT_A, instanceB.id);
      // Tenant A's tenant_id filter means no Tenant B relations are returned
      expect(page.data.every((r) => r.tenantId === TENANT_A)).toBe(true);
    });
  });
});

// ── SEARCH isolation ──────────────────────────────────────────────────────────

describe("searchEntities — cross-tenant search isolation", () => {
  const UNIQUE_TERM = `isoltest_${Date.now()}`;

  beforeAll(async () => {
    // Insert instances with distinct search content directly so the trigger
    // populates search_vector without going through field validation.
    await db.insert(entityInstances).values([
      {
        entityTypeId: entityType.id,
        tenantId: TENANT_A,
        currentState: "initial",
        fields: { note: UNIQUE_TERM },
      },
      {
        entityTypeId: entityType.id,
        tenantId: TENANT_B,
        currentState: "initial",
        fields: { note: UNIQUE_TERM }, // same term, different tenant
      },
    ]);
  });

  it("search results for Tenant A contain no Tenant B instances", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const page = await searchEntities(tx, TENANT_A, {
        entityTypeId: entityType.id,
        query: UNIQUE_TERM,
      });
      const crossTenant = page.data.filter((i) => i.tenantId !== TENANT_A);
      expect(crossTenant).toHaveLength(0);
    });
  });

  it("search results for Tenant B contain no Tenant A instances", async () => {
    await withTenantContext(TENANT_B, async (tx) => {
      const page = await searchEntities(tx, TENANT_B, {
        entityTypeId: entityType.id,
        query: UNIQUE_TERM,
      });
      const crossTenant = page.data.filter((i) => i.tenantId !== TENANT_B);
      expect(crossTenant).toHaveLength(0);
    });
  });
});

// ── RLS layer verification ────────────────────────────────────────────────────

describe("RLS — direct query isolation within tenant context", () => {
  it("direct SELECT within Tenant A context returns no Tenant B rows", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      // Bypass the engine and query directly — RLS (if enforced for this role)
      // should also block cross-tenant reads. The explicit WHERE still applies.
      const rows = await tx
        .select({ id: entityInstances.id, tenantId: entityInstances.tenantId })
        .from(entityInstances)
        .where(
          and(
            eq(entityInstances.entityTypeId, entityType.id),
            eq(entityInstances.tenantId, TENANT_B),
          ),
        );
      // With explicit WHERE tenant_id = TENANT_B inside a TENANT_A context,
      // the engine WHERE already makes this empty. RLS adds a second enforcement
      // layer for non-superuser roles.
      expect(rows).toHaveLength(0);
    });
  });

  it("direct SELECT for own tenant data succeeds within context", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const rows = await tx
        .select({ id: entityInstances.id })
        .from(entityInstances)
        .where(
          and(
            eq(entityInstances.entityTypeId, entityType.id),
            eq(entityInstances.tenantId, TENANT_A),
          ),
        );
      expect(rows.length).toBeGreaterThan(0);
    });
  });
});
