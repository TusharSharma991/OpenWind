import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AuthContext } from "@platform/auth";

// Strategy mirrors my-view.test.ts — mock @platform/db so
// withTenantContext/withTenantAndUserContext never touch a real DB, and mock
// @platform/auth's getSubordinateIds to control the AuthNexus-derived
// subordinate list without a network call.

vi.mock("drizzle-orm", () => {
  const noop = vi.fn(() => "sql");
  const sqlFn = Object.assign(
    (_strings: TemplateStringsArray, ..._vals: unknown[]) => "sql",
    { join: vi.fn(() => "sql") },
  );
  return {
    eq: noop,
    and: noop,
    or: noop,
    isNull: noop,
    sql: sqlFn,
    inArray: noop,
    asc: noop,
    desc: noop,
  };
});

const mockWithTenantContext = vi.fn();

vi.mock("@platform/db", () => {
  const col = (name: string) => name;
  const tbl = (cols: string[]) =>
    Object.fromEntries(cols.map((c) => [c, col(c)]));
  return {
    db: {},
    withTenantContext: (...args: unknown[]) => mockWithTenantContext(...args),
    entityInstances: tbl([
      "id",
      "tenantId",
      "workflowId",
      "entityTypeId",
      "currentState",
      "fields",
      "dueDate",
      "updatedAt",
      "createdAt",
      "assignedTo",
      "createdBy",
      "deletedAt",
    ]),
    entityTypes: tbl(["id", "name"]),
    workflows: tbl(["id", "name", "entityTypeId", "createdBy", "assignedTo"]),
    workflowStates: tbl(["workflowId", "name", "label", "slaHours"]),
  };
});

const mockGetSubordinateIds = vi.fn();
const mockGetUserById = vi.fn();
let capturedAuth: AuthContext = {
  tenantId: "tenant-aaa",
  userId: "user-bbb",
  roles: ["user"],
  orgId: "org-ccc",
} as AuthContext;

vi.mock("@platform/auth", () => ({
  requireAuth:
    () =>
    async (
      c: {
        set: (k: string, v: unknown) => void;
        req: { header: (name: string) => string | undefined };
      },
      next: () => Promise<void>,
    ) => {
      c.set("auth", capturedAuth);
      return next();
    },
  getSubordinateIds: (...args: unknown[]) => mockGetSubordinateIds(...args),
  getUserById: (...args: unknown[]) => mockGetUserById(...args),
}));

vi.mock("@platform/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const { orgViewHandler } = await import("./org-view.js");

function makeApp() {
  const app = new Hono<{ Variables: { auth: AuthContext } }>();
  app.get("/org-view", ...orgViewHandler);
  return app;
}

function scopedIdRows(ids: string[]) {
  return ids.map((id) => ({ id }));
}

describe("GET /dashboard/org-view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedAuth = {
      tenantId: "tenant-aaa",
      userId: "user-bbb",
      roles: ["user"],
      orgId: "org-ccc",
    } as AuthContext;
    mockGetUserById.mockResolvedValue(null);
  });

  it("returns hasReports:false and empty sections when the caller has no reports", async () => {
    mockGetSubordinateIds.mockResolvedValue({
      ids: [],
      hasReports: false,
      status: "ok",
    });

    const res = await makeApp().request("/org-view", {
      headers: { Authorization: "Bearer caller-token" },
    });

    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.hasReports).toBe(false);
    expect(data.unavailable).toBe(false);
    expect(data.tickets).toEqual({ items: [], totalQualifying: 0 });
    // No point resolving entity scoping for an empty subordinate set.
    expect(mockWithTenantContext).not.toHaveBeenCalled();
  });

  it("returns unavailable:true when AuthNexus is unreachable, without throwing", async () => {
    mockGetSubordinateIds.mockResolvedValue({
      ids: [],
      hasReports: false,
      status: "unavailable",
    });

    const res = await makeApp().request("/org-view", {
      headers: { Authorization: "Bearer caller-token" },
    });

    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.unavailable).toBe(true);
    expect(data.hasReports).toBe(false);
  });

  it("returns unavailable:true (never throws) when the caller's token has no orgId", async () => {
    capturedAuth = {
      tenantId: "tenant-aaa",
      userId: "user-bbb",
      roles: ["user"],
    } as AuthContext;

    const res = await makeApp().request("/org-view", {
      headers: { Authorization: "Bearer caller-token" },
    });

    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.unavailable).toBe(true);
    expect(mockGetSubordinateIds).not.toHaveBeenCalled();
  });

  it("passes the caller's own userId (never a client-supplied one) and forwarded bearer token to getSubordinateIds", async () => {
    mockGetSubordinateIds.mockResolvedValue({
      ids: [],
      hasReports: false,
      status: "ok",
    });

    await makeApp().request("/org-view?userId=someone-else", {
      headers: { Authorization: "Bearer the-callers-own-token" },
    });

    expect(mockGetSubordinateIds).toHaveBeenCalledWith(
      "org-ccc",
      "user-bbb", // caller's own JWT-derived userId — the query param is ignored
      "the-callers-own-token",
    );
  });

  it("scopes tickets to [self, ...subordinateIds] and builds sections when the caller has reports", async () => {
    mockGetSubordinateIds.mockResolvedValue({
      ids: ["report-1", "report-2"],
      hasReports: true,
      status: "ok",
    });
    mockWithTenantContext
      .mockResolvedValueOnce(scopedIdRows(["a"])) // resolveUserScopedEntityIds
      .mockResolvedValueOnce([
        {
          id: "a",
          workflowId: null,
          entityTypeId: "et-1",
          currentState: "open",
          fields: { title: "Team ticket" },
          dueDate: null,
          updatedAt: new Date(),
        },
      ]) // rows
      .mockResolvedValueOnce([{ id: "et-1", name: "Ticket" }]); // entityTypes (no workflows on the row)

    const res = await makeApp().request("/org-view", {
      headers: { Authorization: "Bearer caller-token" },
    });

    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.hasReports).toBe(true);
    expect(data.unavailable).toBe(false);
    expect(data.tickets.items).toHaveLength(1);
    expect(data.tickets.items[0].title).toBe("Team ticket");
  });

  it("builds a teamMembers roster row per subordinate, resolving names via getUserById and falling back to the raw id when resolution fails", async () => {
    mockGetSubordinateIds.mockResolvedValue({
      ids: ["report-1", "report-2"],
      hasReports: true,
      status: "ok",
    });
    mockGetUserById.mockImplementation((userId: string) =>
      userId === "report-1"
        ? Promise.resolve({
            userId,
            displayName: "Report One",
            email: "r1@x.com",
            loginName: "r1",
          })
        : Promise.resolve(null),
    );
    mockWithTenantContext
      .mockResolvedValueOnce(scopedIdRows(["a", "b"])) // resolveUserScopedEntityIds
      .mockResolvedValueOnce([
        {
          id: "a",
          workflowId: null,
          entityTypeId: "et-1",
          currentState: "open",
          fields: { title: "Overdue one" },
          dueDate: new Date(Date.now() - 86_400_000),
          updatedAt: new Date(),
          assignedTo: "report-1",
        },
        {
          id: "b",
          workflowId: null,
          entityTypeId: "et-1",
          currentState: "open",
          fields: { title: "Not overdue" },
          dueDate: new Date(Date.now() + 86_400_000),
          updatedAt: new Date(),
          assignedTo: "report-1",
        },
      ]) // rows
      .mockResolvedValueOnce([{ id: "et-1", name: "Ticket" }]); // entityTypes

    const res = await makeApp().request("/org-view", {
      headers: { Authorization: "Bearer caller-token" },
    });

    const { data } = await res.json();
    expect(data.teamMembers.items).toHaveLength(2);
    const one = data.teamMembers.items.find(
      (m: { userId: string }) => m.userId === "report-1",
    );
    expect(one).toMatchObject({
      name: "Report One",
      ticketCount: 2,
      overdueCount: 1,
    });
    const two = data.teamMembers.items.find(
      (m: { userId: string }) => m.userId === "report-2",
    );
    expect(two).toMatchObject({
      name: "report-2", // resolution failed — falls back to the raw id
      ticketCount: 0,
      overdueCount: 0,
    });

    // R12 — tickets.items also carries assignedToName, reusing the same
    // name-resolution pass rather than a second lookup.
    expect(data.tickets.items).toHaveLength(2);
    for (const t of data.tickets.items) {
      expect(t.assignedTo).toBe("report-1");
      expect(t.assignedToName).toBe("Report One");
    }
  });
});
