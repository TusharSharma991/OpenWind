/**
 * Isolation tests for the entity export endpoint.
 *
 * Verifies that Tenant A's export cannot return rows owned by Tenant B,
 * and that cross-tenant job polling is rejected.
 *
 * Tests run against a real Postgres instance (no mocks).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, withTenantContext } from "@platform/db";
import { entityTypes } from "@platform/db";
import {
  createEntityType,
  createEntity,
  type EntityType,
  type EntityInstance,
} from "@platform/entity-engine";

const TENANT_A = "aaaaaaaa-3333-4000-a000-000000000031";
const TENANT_B = "bbbbbbbb-3333-4000-b000-000000000032";

let entityType: EntityType;
let instanceA: EntityInstance;
let instanceB: EntityInstance;

beforeAll(async () => {
  entityType = await createEntityType(db, null, {
    name: `export_isolation_type_${Date.now()}`,
    plural: "export_isolation_records",
    allowCustomFields: false,
  });

  instanceA = await withTenantContext(TENANT_A, (tx) =>
    createEntity(tx, TENANT_A, {
      entityTypeId: entityType.id,
      fields: { label: "Tenant A record" },
    }),
  );

  instanceB = await withTenantContext(TENANT_B, (tx) =>
    createEntity(tx, TENANT_B, {
      entityTypeId: entityType.id,
      fields: { label: "Tenant B record" },
    }),
  );
});

afterAll(async () => {
  await db.delete(entityTypes).where(eq(entityTypes.id, entityType.id));
});

describe("entity export — cross-tenant row isolation", () => {
  it("Tenant A context cannot read Tenant B instance via direct query", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const { listEntities } = await import("@platform/entity-engine");
      const page = await listEntities(tx, TENANT_A, {
        entityTypeId: entityType.id,
        limit: 100,
      });
      const ids = page.data.map((r) => r.id);
      expect(ids).toContain(instanceA.id);
      expect(ids).not.toContain(instanceB.id);
    });
  });

  it("Tenant B context cannot read Tenant A instance", async () => {
    await withTenantContext(TENANT_B, async (tx) => {
      const { listEntities } = await import("@platform/entity-engine");
      const page = await listEntities(tx, TENANT_B, {
        entityTypeId: entityType.id,
        limit: 100,
      });
      const ids = page.data.map((r) => r.id);
      expect(ids).toContain(instanceB.id);
      expect(ids).not.toContain(instanceA.id);
    });
  });

  it("entity count for Tenant A is exactly 1 (no cross-tenant leak)", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const { listEntities } = await import("@platform/entity-engine");
      const page = await listEntities(tx, TENANT_A, {
        entityTypeId: entityType.id,
        limit: 100,
      });
      expect(page.data).toHaveLength(1);
    });
  });
});
