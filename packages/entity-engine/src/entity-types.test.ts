import { describe, it, expect, vi, beforeEach } from "vitest";
import { EntityError } from "./errors.js";

// ── Mock @platform/db ─────────────────────────────────────────────────────────

const mockInsertReturning = vi.fn();
const mockUpdateReturning = vi.fn();
const mockSelectResult = vi.fn();

function makeQueryBuilder(finalResult: () => unknown[]) {
  const q: Record<string, unknown> = {};
  q["from"] = () => q;
  q["where"] = () => q;
  q["orderBy"] = () => q;
  q["limit"] = () => q;
  q["then"] = (resolve: (v: unknown[]) => void) =>
    Promise.resolve(finalResult()).then(resolve);
  return q;
}

const dbMock = {
  select: vi.fn(() => makeQueryBuilder(mockSelectResult)),
  insert: vi.fn(() => ({
    values: vi.fn(() => ({ returning: mockInsertReturning })),
  })),
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({ returning: mockUpdateReturning })),
    })),
  })),
  delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
};

vi.mock("@platform/db", () => ({
  entityTypes: {
    id: "id",
    tenantId: "tenant_id",
    name: "name",
    moduleId: "module_id",
  },
  entityInstances: {
    entityTypeId: "entity_type_id",
    tenantId: "tenant_id",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col, val) => ({ col, val, op: "eq" })),
  and: vi.fn((...args) => ({ args, op: "and" })),
  or: vi.fn((...args) => ({ args, op: "or" })),
  isNull: vi.fn((col) => ({ col, op: "isNull" })),
  count: vi.fn(() => ({ op: "count" })),
}));

vi.mock("@platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Import AFTER mocks ────────────────────────────────────────────────────────

const {
  createEntityType,
  getEntityType,
  listEntityTypes,
  updateEntityType,
  deleteEntityType,
} = await import("./entity-types.js");

const TENANT_ID = "tenant-aaa";
const TYPE_ID = "type-bbb";

const fakeEntityType = {
  id: TYPE_ID,
  tenantId: TENANT_ID,
  name: "ticket",
  plural: "tickets",
  icon: null,
  moduleId: null,
  allowCustomFields: true,
  createdAt: new Date(),
};

describe("createEntityType", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates an entity type and returns it", async () => {
    mockInsertReturning.mockResolvedValue([fakeEntityType]);
    const result = await createEntityType(dbMock as never, TENANT_ID, {
      name: "ticket",
      plural: "tickets",
    });
    expect(result.id).toBe(TYPE_ID);
    expect(result.name).toBe("ticket");
  });

  it("creates a system-level type when tenantId is null", async () => {
    mockInsertReturning.mockResolvedValue([{ ...fakeEntityType, tenantId: null }]);
    const result = await createEntityType(dbMock as never, null, {
      name: "ticket",
      plural: "tickets",
    });
    expect(result.tenantId).toBeNull();
  });
});

describe("getEntityType", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the entity type when found", async () => {
    dbMock.select.mockReturnValue(makeQueryBuilder(() => [fakeEntityType]));
    const result = await getEntityType(dbMock as never, TENANT_ID, TYPE_ID);
    expect(result.id).toBe(TYPE_ID);
  });

  it("throws EntityError when not found", async () => {
    dbMock.select.mockReturnValue(makeQueryBuilder(() => []));
    await expect(
      getEntityType(dbMock as never, TENANT_ID, "nonexistent"),
    ).rejects.toBeInstanceOf(EntityError);
  });
});

describe("listEntityTypes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a list of entity types visible to the tenant", async () => {
    dbMock.select.mockReturnValue(makeQueryBuilder(() => [fakeEntityType]));
    const results = await listEntityTypes(dbMock as never, TENANT_ID);
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("ticket");
  });

  it("returns empty array when none found", async () => {
    dbMock.select.mockReturnValue(makeQueryBuilder(() => []));
    const results = await listEntityTypes(dbMock as never, TENANT_ID, {
      moduleId: "unknown-module",
    });
    expect(results).toHaveLength(0);
  });
});

describe("updateEntityType", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates and returns the entity type", async () => {
    const updated = { ...fakeEntityType, name: "incident" };
    dbMock.select.mockReturnValue(makeQueryBuilder(() => [fakeEntityType]));
    mockUpdateReturning.mockResolvedValue([updated]);
    const result = await updateEntityType(dbMock as never, TENANT_ID, TYPE_ID, {
      name: "incident",
    });
    expect(result.name).toBe("incident");
  });

  it("returns existing type unchanged when input is empty", async () => {
    dbMock.select.mockReturnValue(makeQueryBuilder(() => [fakeEntityType]));
    const result = await updateEntityType(dbMock as never, TENANT_ID, TYPE_ID, {});
    expect(result.id).toBe(TYPE_ID);
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("throws EntityError when entity type not found", async () => {
    dbMock.select.mockReturnValue(makeQueryBuilder(() => []));
    await expect(
      updateEntityType(dbMock as never, TENANT_ID, "nonexistent", { name: "x" }),
    ).rejects.toBeInstanceOf(EntityError);
  });
});

describe("deleteEntityType", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes the entity type when no instances exist", async () => {
    dbMock.select
      .mockReturnValueOnce(makeQueryBuilder(() => [{ id: TYPE_ID }]))
      .mockReturnValue(makeQueryBuilder(() => [{ count: 0 }]));
    await expect(
      deleteEntityType(dbMock as never, TENANT_ID, TYPE_ID),
    ).resolves.toBeUndefined();
    expect(dbMock.delete).toHaveBeenCalledTimes(1);
  });

  it("throws ENTITY_TYPE_HAS_INSTANCES when instances exist", async () => {
    dbMock.select
      .mockReturnValueOnce(makeQueryBuilder(() => [{ id: TYPE_ID }]))
      .mockReturnValue(makeQueryBuilder(() => [{ count: 3 }]));
    await expect(
      deleteEntityType(dbMock as never, TENANT_ID, TYPE_ID),
    ).rejects.toMatchObject({ code: "ENTITY_TYPE_HAS_INSTANCES" });
    expect(dbMock.delete).not.toHaveBeenCalled();
  });

  it("throws EntityError when entity type not found", async () => {
    dbMock.select.mockReturnValue(makeQueryBuilder(() => []));
    await expect(
      deleteEntityType(dbMock as never, TENANT_ID, "nonexistent"),
    ).rejects.toBeInstanceOf(EntityError);
    expect(dbMock.delete).not.toHaveBeenCalled();
  });
});
