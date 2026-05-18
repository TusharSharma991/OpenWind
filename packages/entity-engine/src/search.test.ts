import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock @platform/db ─────────────────────────────────────────────────────────

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
};

vi.mock("@platform/db", () => ({
  entityInstances: {
    id: "id",
    entityTypeId: "entity_type_id",
    tenantId: "tenant_id",
    workflowId: "workflow_id",
    currentState: "current_state",
    fields: "fields",
    createdBy: "created_by",
    assignedTo: "assigned_to",
    createdAt: "created_at",
    updatedAt: "updated_at",
    deletedAt: { deleted_at: "deleted_at" },
    searchVector: "search_vector",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col, val) => ({ col, val, op: "eq" })),
  and: vi.fn((...args) => ({ args, op: "and" })),
  or: vi.fn((...args) => ({ args, op: "or" })),
  isNull: vi.fn((col) => ({ col, op: "isNull" })),
  desc: vi.fn((col) => ({ col, op: "desc" })),
  sql: Object.assign(
    vi.fn((...args) => ({ args, op: "sql" })),
    { raw: vi.fn() },
  ),
}));

vi.mock("@platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@platform/config", () => ({
  env: { REDIS_URL: "redis://localhost:6379" },
}));

// ── Import after mocks ────────────────────────────────────────────────────────

const { searchEntities } = await import("./search.js");

const TENANT_ID = "tenant-aaa";
const ENTITY_TYPE_ID = "type-bbb";
const INSTANCE_ID = "instance-ccc";

const fakeRow = {
  id: INSTANCE_ID,
  entityTypeId: ENTITY_TYPE_ID,
  tenantId: TENANT_ID,
  workflowId: null,
  currentState: "open",
  fields: { subject: "Fix the bug" },
  createdBy: null,
  assignedTo: null,
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
  deletedAt: null,
  searchVector: null,
  rank: 0.1,
};

describe("searchEntities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.select.mockReturnValue(makeQueryBuilder(mockSelectResult));
  });

  it("returns matching instances as a cursor page", async () => {
    mockSelectResult.mockReturnValue([fakeRow]);
    const page = await searchEntities(dbMock as never, TENANT_ID, {
      entityTypeId: ENTITY_TYPE_ID,
      query: "bug",
    });
    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.id).toBe(INSTANCE_ID);
    expect(page.nextCursor).toBeNull();
  });

  it("returns empty page when no matches", async () => {
    mockSelectResult.mockReturnValue([]);
    const page = await searchEntities(dbMock as never, TENANT_ID, {
      entityTypeId: ENTITY_TYPE_ID,
      query: "nonexistent",
    });
    expect(page.data).toHaveLength(0);
    expect(page.nextCursor).toBeNull();
  });

  it("sets nextCursor when more results exist beyond the limit", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      ...fakeRow,
      id: `instance-${i}`,
      rank: 0.5 - i * 0.1,
    }));
    mockSelectResult.mockReturnValue(rows);
    const page = await searchEntities(dbMock as never, TENANT_ID, {
      entityTypeId: ENTITY_TYPE_ID,
      query: "bug",
      limit: 2,
    });
    expect(page.data).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
  });

  it("uses isNull(deletedAt) to exclude soft-deleted instances", async () => {
    const { isNull } = await import("drizzle-orm");
    mockSelectResult.mockReturnValue([]);
    await searchEntities(dbMock as never, TENANT_ID, {
      entityTypeId: ENTITY_TYPE_ID,
      query: "bug",
    });
    expect(isNull).toHaveBeenCalledWith(
      expect.objectContaining({ deleted_at: "deleted_at" }),
    );
  });

  it("encodes rank + id into nextCursor", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      ...fakeRow,
      id: `instance-${i}`,
      rank: 0.9 - i * 0.1,
    }));
    mockSelectResult.mockReturnValue(rows);
    const page = await searchEntities(dbMock as never, TENANT_ID, {
      entityTypeId: ENTITY_TYPE_ID,
      query: "fix",
      limit: 2,
    });
    expect(page.nextCursor).not.toBeNull();
    const decoded = JSON.parse(
      Buffer.from(page.nextCursor!, "base64url").toString(),
    ) as { rank: number; id: string };
    expect(typeof decoded.rank).toBe("number");
    expect(typeof decoded.id).toBe("string");
    expect(decoded.id).toBe("instance-1");
  });

  it("maps row to EntityInstance (strips rank and searchVector)", async () => {
    mockSelectResult.mockReturnValue([fakeRow]);
    const page = await searchEntities(dbMock as never, TENANT_ID, {
      entityTypeId: ENTITY_TYPE_ID,
      query: "bug",
    });
    const instance = page.data[0]!;
    expect(instance).not.toHaveProperty("rank");
    expect(instance).not.toHaveProperty("searchVector");
    expect(instance.fields).toEqual({ subject: "Fix the bug" });
    expect(instance.deletedAt).toBeNull();
  });
});
