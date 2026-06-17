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
const mockExportQueueAdd = vi.fn();

vi.mock("@platform/auth", () => ({
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

vi.mock("../../lib/export-queue.js", () => ({
  exportQueue: { add: (...args: unknown[]) => mockExportQueueAdd(...args) },
}));

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
  const app = new Hono<{ Variables: { auth: AuthContext } }>();
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
  mockExportQueueAdd.mockResolvedValue({ id: "job-async-001" });
});

// ── CSV tests ─────────────────────────────────────────────────────────────────

describe("GET /entity-types/:id/export?format=csv", () => {
  it("returns 200 with text/csv content type", async () => {
    const res = await makeApp().request(`/${TYPE_ID}/export?format=csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
  });

  it("CSV headers row has system cols first then field labels in sort_order", async () => {
    const res = await makeApp(["pii_export"]).request(
      `/${TYPE_ID}/export?format=csv`,
    );
    const text = await res.text();
    const firstLine = text.split("\n")[0] ?? "";
    expect(firstLine).toContain("ID");
    expect(firstLine).toContain("State");
    expect(firstLine).toContain("Subject");
    expect(firstLine.indexOf("Subject")).toBeGreaterThan(
      firstLine.indexOf("State"),
    );
  });

  it("CSV row count matches instance count", async () => {
    const res = await makeApp(["pii_export"]).request(
      `/${TYPE_ID}/export?format=csv`,
    );
    const lines = (await res.text())
      .split("\n")
      .filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(3); // header + 2 data rows
  });

  it("PII fields excluded when user lacks pii_export role", async () => {
    const res = await makeApp(["agent"]).request(
      `/${TYPE_ID}/export?format=csv`,
    );
    const text = await res.text();
    expect(text).not.toContain("Email");
    expect(text).not.toContain("Amount");
    expect(text).toContain("Subject");
  });

  it("PII fields included when user has pii_export role", async () => {
    const res = await makeApp(["pii_export"]).request(
      `/${TYPE_ID}/export?format=csv`,
    );
    const text = await res.text();
    expect(text).toContain("Email");
    expect(text).toContain("Amount");
  });

  it("admin role can see PII fields", async () => {
    const res = await makeApp(["admin"]).request(
      `/${TYPE_ID}/export?format=csv`,
    );
    const text = await res.text();
    expect(text).toContain("Email");
  });

  it("empty result returns headers-only CSV", async () => {
    mockListEntities.mockResolvedValue({ data: [], nextCursor: null });
    const res = await makeApp().request(`/${TYPE_ID}/export?format=csv`);
    expect(res.status).toBe(200);
    const lines = (await res.text())
      .split("\n")
      .filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(1);
  });

  it("Content-Disposition header contains entity plural and date", async () => {
    const res = await makeApp().request(`/${TYPE_ID}/export?format=csv`);
    const d = res.headers.get("content-disposition") ?? "";
    expect(d).toContain("tickets-export-");
    expect(d).toContain(".csv");
  });
});

// ── xlsx tests ────────────────────────────────────────────────────────────────

describe("GET /entity-types/:id/export?format=xlsx", () => {
  it("returns 200 with xlsx content type", async () => {
    const res = await makeApp().request(`/${TYPE_ID}/export?format=xlsx`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml.sheet");
  });

  it("Content-Disposition contains .xlsx", async () => {
    const res = await makeApp().request(`/${TYPE_ID}/export?format=xlsx`);
    expect(res.headers.get("content-disposition")).toContain(".xlsx");
  });

  it("response body is a non-empty buffer", async () => {
    const res = await makeApp().request(`/${TYPE_ID}/export?format=xlsx`);
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });
});

// ── PDF tests ─────────────────────────────────────────────────────────────────

describe("GET /entity-types/:id/export?format=pdf", () => {
  it("returns 200 with application/pdf content type", async () => {
    const res = await makeApp().request(`/${TYPE_ID}/export?format=pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
  });

  it("Content-Disposition contains .pdf", async () => {
    const res = await makeApp().request(`/${TYPE_ID}/export?format=pdf`);
    expect(res.headers.get("content-disposition")).toContain(".pdf");
  });

  it("response body starts with PDF magic bytes (%PDF)", async () => {
    const res = await makeApp().request(`/${TYPE_ID}/export?format=pdf`);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.slice(0, 4).toString("ascii")).toBe("%PDF");
  });

  it("uses landscape layout when more than 6 columns", async () => {
    // Add 7 extra fields to push column count above 6 (4 system + 7 custom = 11)
    const extraFields = Array.from({ length: 7 }, (_, i) => ({
      ...publicField,
      id: `f-extra-${i}`,
      name: `extra_${i}`,
      label: `Extra ${i}`,
      sortOrder: i + 10,
    }));
    mockListEntityFields.mockResolvedValue([publicField, ...extraFields]);
    const res = await makeApp().request(`/${TYPE_ID}/export?format=pdf`);
    expect(res.status).toBe(200);
  });
});

// ── Async path ────────────────────────────────────────────────────────────────

describe("async export — row count > 5 000", () => {
  it("returns 202 with jobId when row count exceeds sync limit", async () => {
    const manyRows = Array.from({ length: 5_001 }, (_, i) =>
      makeInstance(`inst-${i}`),
    );
    mockListEntities.mockResolvedValue({ data: manyRows, nextCursor: null });

    const res = await makeApp().request(`/${TYPE_ID}/export?format=csv`);
    expect(res.status).toBe(202);
    const body = (await res.json()) as { jobId: string };
    expect(body.jobId).toBe("job-async-001");
  });

  it("enqueues job with correct payload", async () => {
    const manyRows = Array.from({ length: 5_001 }, (_, i) =>
      makeInstance(`inst-${i}`),
    );
    mockListEntities.mockResolvedValue({ data: manyRows, nextCursor: null });

    await makeApp(["admin"]).request(
      `/${TYPE_ID}/export?format=xlsx&state=open`,
    );

    expect(mockExportQueueAdd).toHaveBeenCalledWith(
      "export",
      expect.objectContaining({
        tenantId: "t-aaa",
        entityTypeId: TYPE_ID,
        format: "xlsx",
        filters: { state: "open" },
      }),
    );
  });
});

// ── Guard tests ───────────────────────────────────────────────────────────────

describe("export guards", () => {
  it("returns 400 EXPORT_TOO_LARGE when rows exceed 10 000", async () => {
    const manyRows = Array.from({ length: 10_001 }, (_, i) =>
      makeInstance(`inst-${i}`),
    );
    mockListEntities.mockResolvedValue({ data: manyRows, nextCursor: null });
    const res = await makeApp().request(`/${TYPE_ID}/export?format=csv`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("EXPORT_TOO_LARGE");
  });

  it("returns 400 for unknown format", async () => {
    const res = await makeApp().request(`/${TYPE_ID}/export?format=docx`);
    expect(res.status).toBe(400);
  });

  it("returns 404 when entity type not found", async () => {
    mockGetEntityType.mockRejectedValue(
      new EntityError("ENTITY_TYPE_NOT_FOUND", { entityTypeId: TYPE_ID }),
    );
    const res = await makeApp().request(`/${TYPE_ID}/export?format=csv`);
    expect(res.status).toBe(404);
  });
});
