import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AuthContext } from "@platform/auth";

// Strategy mirrors org-view.test.ts — mock @platform/db so
// withTenantContext never touches a real DB, and mock @platform/auth's
// getSubordinateIds/getUserById to control authorization without a network
// call.

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
  userId: "manager-1",
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

const { teamMemberViewHandler } = await import("./team-member-view.js");

function makeApp() {
  const app = new Hono<{ Variables: { auth: AuthContext } }>();
  app.get("/team-member-view/:userId", ...teamMemberViewHandler);
  return app;
}

function scopedIdRows(ids: string[]) {
  return ids.map((id) => ({ id }));
}

describe("GET /dashboard/team-member-view/:userId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedAuth = {
      tenantId: "tenant-aaa",
      userId: "manager-1",
      roles: ["user"],
      orgId: "org-ccc",
    } as AuthContext;
  });

  it("404s when the requested userId is not in the caller's subordinate list", async () => {
    mockGetSubordinateIds.mockResolvedValue({
      ids: ["report-1", "report-2"],
      hasReports: true,
      status: "ok",
    });

    const res = await makeApp().request("/team-member-view/not-my-report", {
      headers: { Authorization: "Bearer caller-token" },
    });

    expect(res.status).toBe(404);
    expect(mockWithTenantContext).not.toHaveBeenCalled();
  });

  it("404s (fails closed) when AuthNexus is unreachable, even for a plausible-looking userId", async () => {
    mockGetSubordinateIds.mockResolvedValue({
      ids: [],
      hasReports: false,
      status: "unavailable",
    });

    const res = await makeApp().request("/team-member-view/report-1", {
      headers: { Authorization: "Bearer caller-token" },
    });

    expect(res.status).toBe(404);
  });

  it("404s when the caller's token has no orgId, never calling getSubordinateIds", async () => {
    capturedAuth = {
      tenantId: "tenant-aaa",
      userId: "manager-1",
      roles: ["user"],
    } as AuthContext;

    const res = await makeApp().request("/team-member-view/report-1", {
      headers: { Authorization: "Bearer caller-token" },
    });

    expect(res.status).toBe(404);
    expect(mockGetSubordinateIds).not.toHaveBeenCalled();
  });

  it("passes the caller's own userId (never the target) to getSubordinateIds", async () => {
    mockGetSubordinateIds.mockResolvedValue({
      ids: ["report-1"],
      hasReports: true,
      status: "ok",
    });
    mockGetUserById.mockResolvedValue(null);
    // buildScopedDashboardSections short-circuits to EMPTY_SECTIONS as soon as
    // resolveUserScopedEntityIds returns [] — only ONE withTenantContext call
    // happens, so only one value should be queued here (a second, unconsumed
    // queued value would leak into the next test's mock queue).
    mockWithTenantContext.mockResolvedValueOnce(scopedIdRows([]));

    await makeApp().request("/team-member-view/report-1", {
      headers: { Authorization: "Bearer the-callers-own-token" },
    });

    expect(mockGetSubordinateIds).toHaveBeenCalledWith(
      "org-ccc",
      "manager-1", // caller's own JWT-derived userId, not the target
      "the-callers-own-token",
    );
  });

  it("returns the target's ticket-scoped dashboard with adminWorkflows/savedViews/pendingApprovals always empty", async () => {
    mockGetSubordinateIds.mockResolvedValue({
      ids: ["report-1"],
      hasReports: true,
      status: "ok",
    });
    mockGetUserById.mockResolvedValue({
      userId: "report-1",
      displayName: "Report One",
      email: "r1@x.com",
      loginName: "r1",
    });
    mockWithTenantContext
      .mockResolvedValueOnce(scopedIdRows(["a"])) // resolveUserScopedEntityIds
      .mockResolvedValueOnce([
        {
          id: "a",
          workflowId: null,
          entityTypeId: "et-1",
          currentState: "open",
          fields: { title: "Their ticket" },
          dueDate: null,
          updatedAt: new Date(),
          assignedTo: "report-1",
        },
      ]) // rows
      .mockResolvedValueOnce([{ id: "et-1", name: "Ticket" }]); // entityTypes

    const res = await makeApp().request("/team-member-view/report-1", {
      headers: { Authorization: "Bearer caller-token" },
    });

    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.targetUser).toEqual({ userId: "report-1", name: "Report One" });
    expect(data.tickets.items).toHaveLength(1);
    expect(data.tickets.items[0].title).toBe("Their ticket");
    expect(data.adminWorkflows).toEqual([]);
    expect(data.savedViews).toEqual([]);
    expect(data.pendingApprovals).toEqual({ items: [], totalQualifying: 0 });
  });

  it("falls back to the raw userId as the display name when getUserById resolution fails", async () => {
    mockGetSubordinateIds.mockResolvedValue({
      ids: ["report-1"],
      hasReports: true,
      status: "ok",
    });
    mockGetUserById.mockResolvedValue(null);
    mockWithTenantContext.mockResolvedValueOnce(scopedIdRows([]));

    const res = await makeApp().request("/team-member-view/report-1", {
      headers: { Authorization: "Bearer caller-token" },
    });

    const { data } = await res.json();
    expect(data.targetUser).toEqual({ userId: "report-1", name: "report-1" });
  });
});
