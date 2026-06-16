import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import type { AuthContext } from "@platform/auth";
import type * as EntityEngine from "@platform/entity-engine";
import { EntityError } from "@platform/entity-engine";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockGetEntityType = vi.fn();
const mockListEntityFields = vi.fn();
const mockListEntities = vi.fn();

vi.mock("@platform/auth", () => ({
  // Pass-through — auth is set by makeApp's app.use("*",...) middleware,
  // which must run before route-level requireAuth to control per-test roles.
  requireAuth: () => async (_c: Context, next: Next) => {
    await next();
  },
  requireRole: () => async (_c: Context, next: Next) => {
    await next();
  },
}));

vi.mock("@platform/db", () => ({
  db: {},
  withTenantContext: (_tenantId: string, fn: (tx: unknown) => unknown) =>
    fn({}),
}));

vi.mock("@platform/entity-engine", async (importOriginal) => {
  const real = await importOriginal<typeof EntityEngine>();
  return {
    ...real,
    getEntityType: (...args: unknown[]) => mockGetEntityType(...args),
    listEntityFields: (...args: unknown[]) => mockListEntityFields(...args),
    listEntities: (...args: unknown[]) => mockListEntities(...args),
  };
});

// csv-stringify/sync is a real dep — no need to mock it
// exceljs is a real dep — no need to mock it

const { exportEntitiesHandler } = await import("./export.js");

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TYPE_ID = "00000000-0000-0000-0000-000000000001";

const fakeEntityType = {
  id: TYPE_ID,
  tenantId: "t-aaa",
  name: "ticket",
  plural: "Tickets",
  icon: null,
  moduleId: null,
  allowCustomFields: true,
  createdAt: new Date("2026-01-01"),
};

const publicField = {
  id: "f-001",
  entityTypeId: TYPE_ID,
  tenantId: null,
  name: "subject",
  label: "Subject",
  fieldType: "text" as const,
  config: {},
  isRequired: true,
  isIndexed: false,
  isSystem: false,
  sortOrder: 0,
  sensitivity: "public" as const,
  createdAt: new Date("2026-01-01"),
};

const piiField = {
  ...publicField,
  id: "f-002",
  name: "email",
  label: "Email",
  sensitivity: "pii" as const,
  sortOrder: 1,
};

const financialField = {
  ...publicField,
  id: "f-003",
  name: "amount",
  label: "Amount",
  sensitivity: "financial" as const,
  sortOrder: 2,
};

function makeInstance(id: string) {
  return {
    id,
    entityTypeId: TYPE_ID,
    tenantId: "t-aaa",
    workflowId: null,
    currentState: "open",
    fields: { subject: "Test ticket", email: "user@example.com", amount: 100 },
    createdBy: null,
    assignedTo: null,
    createdAt: new Date("2026-01-15"),
    updatedAt: new Date("2026-01-15"),
    deletedAt: null,
  };
}

function makeApp(roles: string[] = ["admin"]) {
  // Override auth mock for role-specific tests
  const app = new Hono<{
    Variables: { auth: AuthContext; typeId: string };
  }>();
  app.use("*", async (c, next) => {
    c.set("auth", {
      tenantId: "t-aaa",
      userId: "u-bbb",
      roles,
      email: "test@example.com",
    });
    await next();
  });
  app.get("/:id/export", ...exportEntitiesHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetEntityType.mockResolvedValue(fakeEntityType);
  mockListEntityFields.mockResolvedValue([
    publicField,
    piiField,
    financialField,
  ]);
  mockListEntities.mockResolvedValue({
    data: [makeInstance("inst-1"), makeInstance("inst-2")],
    nextCursor: null,
  });
});

// ── CSV tests ─────────────────────────────────────────────────────────────────

describe("GET /entity-types/:id/export?format=csv", () => {
  it("returns 200 with text/csv content type", async () => {
    const app = makeApp();
    const res = await app.request(`/${TYPE_ID}/export?format=csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
  });

  it("CSV headers row matches field labels in sort_order with system cols first", async () => {
    const app = makeApp(["pii_export"]);
    const res = await app.request(`/${TYPE_ID}/export?format=csv`);
    const text = await res.text();
    const firstLine = text.split("\n")[0] ?? "";
    expect(firstLine).toContain("ID");
    expect(firstLine).toContain("State");
    expect(firstLine).toContain("Subject");
    // index of Subject should come after State
    expect(firstLine.indexOf("Subject")).toBeGreaterThan(
      firstLine.indexOf("State"),
    );
  });

  it("CSV row count matches instance count", async () => {
    const app = makeApp(["pii_export"]);
    const res = await app.request(`/${TYPE_ID}/export?format=csv`);
    const text = await res.text();
    // header row + 2 data rows = 3 non-empty lines
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(3);
  });

  it("PII fields excluded when user lacks pii_export role", async () => {
    const app = makeApp(["agent"]); // no pii_export
    const res = await app.request(`/${TYPE_ID}/export?format=csv`);
    const text = await res.text();
    expect(text).not.toContain("Email");
    expect(text).not.toContain("Amount");
    expect(text).toContain("Subject");
  });

  it("PII fields included when user has pii_export role", async () => {
    const app = makeApp(["pii_export"]);
    const res = await app.request(`/${TYPE_ID}/export?format=csv`);
    const text = await res.text();
    expect(text).toContain("Email");
    expect(text).toContain("Amount");
  });

  it("admin role can see PII fields", async () => {
    const app = makeApp(["admin"]);
    const res = await app.request(`/${TYPE_ID}/export?format=csv`);
    const text = await res.text();
    expect(text).toContain("Email");
  });

  it("empty result returns headers-only CSV (not 404)", async () => {
    mockListEntities.mockResolvedValue({ data: [], nextCursor: null });
    const app = makeApp();
    const res = await app.request(`/${TYPE_ID}/export?format=csv`);
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(1); // headers only
  });

  it("Content-Disposition header contains entity plural and date", async () => {
    const app = makeApp();
    const res = await app.request(`/${TYPE_ID}/export?format=csv`);
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("tickets-export-");
    expect(disposition).toContain(".csv");
  });
});

// ── xlsx tests ────────────────────────────────────────────────────────────────

describe("GET /entity-types/:id/export?format=xlsx", () => {
  it("returns 200 with xlsx content type", async () => {
    const app = makeApp();
    const res = await app.request(`/${TYPE_ID}/export?format=xlsx`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml.sheet");
  });

  it("Content-Disposition header contains .xlsx", async () => {
    const app = makeApp();
    const res = await app.request(`/${TYPE_ID}/export?format=xlsx`);
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toContain(".xlsx");
  });

  it("response body is a non-empty buffer", async () => {
    const app = makeApp();
    const res = await app.request(`/${TYPE_ID}/export?format=xlsx`);
    const buffer = await res.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
  });
});

// ── Guard tests ───────────────────────────────────────────────────────────────

describe("export guards", () => {
  it("returns 400 EXPORT_TOO_LARGE when rows exceed limit", async () => {
    const manyRows = Array.from({ length: 10_001 }, (_, i) =>
      makeInstance(`inst-${i}`),
    );
    mockListEntities.mockResolvedValue({ data: manyRows, nextCursor: null });
    const app = makeApp();
    const res = await app.request(`/${TYPE_ID}/export?format=csv`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("EXPORT_TOO_LARGE");
  });

  it("returns 400 for invalid format", async () => {
    const app = makeApp();
    const res = await app.request(`/${TYPE_ID}/export?format=pdf`);
    expect(res.status).toBe(400);
  });

  it("returns 404 when entity type not found", async () => {
    mockGetEntityType.mockRejectedValue(
      new EntityError("ENTITY_TYPE_NOT_FOUND", { entityTypeId: TYPE_ID }),
    );
    const app = makeApp();
    const res = await app.request(`/${TYPE_ID}/export?format=csv`);
    expect(res.status).toBe(404);
  });
});
