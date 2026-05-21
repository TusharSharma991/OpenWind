/**
 * ref-validator.test.ts
 *
 * Unit tests for the cross-tenant entity_ref and user_ref validators.
 * The DB is fully mocked — these tests cover the batch-lookup logic,
 * INVALID_REFERENCE error shape, empty short-circuits, and partial-update
 * behaviour without requiring a live database connection.
 */

import { describe, it, expect, vi } from "vitest";
import type { DbOrTx } from "@platform/db";
import type { EntityField } from "../types.js";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  inArray: vi.fn(),
}));

vi.mock("@platform/db", () => ({
  entityInstances: {
    id: "entity_instances.id",
    tenantId: "entity_instances.tenant_id",
  },
  tenantUsers: {
    userId: "tenant_users.user_id",
    tenantId: "tenant_users.tenant_id",
  },
}));

const { validateEntityRefs, validateUserRefs } =
  await import("./ref-validator.js");

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a mock DrizzleORM db that returns `rows` from any select chain. */
function makeMockDb(rows: unknown[]): DbOrTx {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(rows),
      }),
    }),
  } as unknown as DbOrTx;
}

const TENANT_ID = "tenant-abc";

// ── validateEntityRefs ────────────────────────────────────────────────────────

describe("validateEntityRefs", () => {
  const refField: EntityField = {
    name: "relatedTo",
    fieldType: "entity_ref",
  } as EntityField;

  it("returns no errors when entity_ref points to a same-tenant instance", async () => {
    const refId = "entity-uuid-1";
    const db = makeMockDb([{ id: refId }]);

    const errors = await validateEntityRefs(
      db,
      TENANT_ID,
      { relatedTo: refId },
      [refField],
    );

    expect(errors).toHaveLength(0);
  });

  it("returns INVALID_REFERENCE when ref belongs to a different tenant", async () => {
    // DB returns empty — the UUID exists but is owned by another tenant
    const db = makeMockDb([]);

    const errors = await validateEntityRefs(
      db,
      TENANT_ID,
      { relatedTo: "foreign-entity-uuid" },
      [refField],
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("INVALID_REFERENCE");
    expect(errors[0]?.field).toBe("relatedTo");
    expect(errors[0]?.meta).toMatchObject({ refId: "foreign-entity-uuid" });
  });

  it("returns INVALID_REFERENCE when the ref UUID does not exist at all", async () => {
    const db = makeMockDb([]);

    const errors = await validateEntityRefs(
      db,
      TENANT_ID,
      { relatedTo: "non-existent-uuid" },
      [refField],
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("INVALID_REFERENCE");
  });

  it("short-circuits without a DB call when no entity_ref fields exist", async () => {
    const db = makeMockDb([]);
    const textField: EntityField = {
      name: "name",
      fieldType: "text",
    } as EntityField;

    const errors = await validateEntityRefs(
      db,
      TENANT_ID,
      { name: "some string" },
      [textField],
    );

    expect(errors).toHaveLength(0);
    expect(
      (db as { select: ReturnType<typeof vi.fn> }).select,
    ).not.toHaveBeenCalled();
  });

  it("short-circuits without a DB call when entity_ref field is absent from submitted fields (partial update)", async () => {
    // Field definition declares entity_ref but the caller did not include it
    const db = makeMockDb([]);

    const errors = await validateEntityRefs(db, TENANT_ID, {}, [refField]);

    expect(errors).toHaveLength(0);
    expect(
      (db as { select: ReturnType<typeof vi.fn> }).select,
    ).not.toHaveBeenCalled();
  });

  it("returns one error per invalid ref in a multi-ref payload (all invalid)", async () => {
    const validId = "valid-uuid";
    // Only `validId` is returned — the other two are cross-tenant or missing
    const db = makeMockDb([{ id: validId }]);

    const secondRefField: EntityField = {
      name: "secondRef",
      fieldType: "entity_ref",
    } as EntityField;

    const errors = await validateEntityRefs(
      db,
      TENANT_ID,
      { relatedTo: "bad-uuid-1", secondRef: "bad-uuid-2" },
      [refField, secondRefField],
    );

    expect(errors).toHaveLength(2);
    expect(errors.map((e) => e.field).sort()).toEqual([
      "relatedTo",
      "secondRef",
    ]);
  });

  it("returns only one error when one ref is valid and the other is invalid (mixed payload)", async () => {
    const validId = "valid-uuid";
    // DB returns `validId` as belonging to this tenant; `bad-uuid` is absent
    const db = makeMockDb([{ id: validId }]);

    const secondRefField: EntityField = {
      name: "secondRef",
      fieldType: "entity_ref",
    } as EntityField;

    const errors = await validateEntityRefs(
      db,
      TENANT_ID,
      { relatedTo: validId, secondRef: "bad-uuid" },
      [refField, secondRefField],
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]?.field).toBe("secondRef");
    expect(errors[0]?.code).toBe("INVALID_REFERENCE");
  });
});

// ── validateUserRefs ──────────────────────────────────────────────────────────

describe("validateUserRefs", () => {
  const userRefField: EntityField = {
    name: "assignedTo",
    fieldType: "user_ref",
  } as EntityField;

  it("returns no errors when user has authenticated into the tenant", async () => {
    const userId = "user-uuid-1";
    const db = makeMockDb([{ userId }]);

    const errors = await validateUserRefs(
      db,
      TENANT_ID,
      { assignedTo: userId },
      [userRefField],
    );

    expect(errors).toHaveLength(0);
  });

  it("returns INVALID_REFERENCE when user has never authenticated into this tenant", async () => {
    // User exists in Zitadel but has not yet hit this tenant's API — absent
    // from tenant_users shadow table
    const db = makeMockDb([]);

    const errors = await validateUserRefs(
      db,
      TENANT_ID,
      { assignedTo: "unregistered-user-uuid" },
      [userRefField],
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("INVALID_REFERENCE");
    expect(errors[0]?.field).toBe("assignedTo");
    expect(errors[0]?.meta).toMatchObject({ userId: "unregistered-user-uuid" });
  });

  it("returns INVALID_REFERENCE for a user from a different tenant", async () => {
    const db = makeMockDb([]);

    const errors = await validateUserRefs(
      db,
      TENANT_ID,
      { assignedTo: "other-tenant-user-uuid" },
      [userRefField],
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("INVALID_REFERENCE");
  });

  it("short-circuits without a DB call when no user_ref fields exist", async () => {
    const db = makeMockDb([]);
    const textField: EntityField = {
      name: "title",
      fieldType: "text",
    } as EntityField;

    const errors = await validateUserRefs(db, TENANT_ID, { title: "hello" }, [
      textField,
    ]);

    expect(errors).toHaveLength(0);
    expect(
      (db as { select: ReturnType<typeof vi.fn> }).select,
    ).not.toHaveBeenCalled();
  });

  it("short-circuits without a DB call when user_ref field is absent from submitted fields (partial update)", async () => {
    const db = makeMockDb([]);

    const errors = await validateUserRefs(db, TENANT_ID, {}, [userRefField]);

    expect(errors).toHaveLength(0);
    expect(
      (db as { select: ReturnType<typeof vi.fn> }).select,
    ).not.toHaveBeenCalled();
  });
});
