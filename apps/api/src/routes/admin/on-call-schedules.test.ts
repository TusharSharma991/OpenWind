import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import type { AuthContext } from "@platform/auth";

const { mockAuth, mockWriteAuditEntry, mockOrgUsers, mockRolesByUserId } =
  vi.hoisted(() => ({
    mockAuth: {
      tenantId: "t-aaa",
      userId: "u-bbb",
      orgId: "org-aaa",
      roles: ["admin"] as string[],
      email: "test@example.com",
    },
    mockWriteAuditEntry: vi.fn(),
    // Fixture for the Zitadel-org fallback in validateScheduleRefs — a user id
    // present here but NOT in the tenant_users mock below simulates an
    // agent/admin who's never logged into OpenWind (the bug this fallback
    // fixes: they're selectable via the live-Zitadel-sourced GET
    // /admin/members picker but previously 422'd on save).
    mockOrgUsers: [] as {
      userId: string;
      email: string;
      displayName: string;
    }[],
    mockRolesByUserId: new Map<string, string[]>(),
  }));

vi.mock("@platform/auth", () => ({
  requireAuth:
    () =>
    async (c: Context<{ Variables: { auth: AuthContext } }>, next: Next) => {
      c.set("auth", mockAuth as AuthContext);
      await next();
    },
  requireRole:
    (...allowedRoles: string[]) =>
    async (c: Context<{ Variables: { auth: AuthContext } }>, next: Next) => {
      const auth = c.get("auth");
      if (!auth?.roles.some((r) => allowedRoles.includes(r))) {
        return c.json({ error: "FORBIDDEN" }, 403);
      }
      await next();
    },
  listOrgUsers: async () => mockOrgUsers,
  listUserRolesByUserId: async () => mockRolesByUserId,
}));

const FUTURE_START = new Date(Date.now() + 24 * 60 * 60 * 1000);
const FUTURE_END = new Date(Date.now() + 48 * 60 * 60 * 1000);

const mockScheduleRow = {
  id: "33333333-3333-4333-8333-333333333333",
  tenantId: "t-aaa",
  teamId: "11111111-1111-4111-8111-111111111111",
  label: "Week 1",
  startsAt: FUTURE_START,
  endsAt: FUTURE_END,
  primaryUserId: "u-bbb",
  backupUserId: null,
  escalationManagerUserId: null,
  createdBy: "u-bbb",
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

let overlapConflict = false;
let getReturnsRow = true;
// tenant_users' known user ids -- mutable so a test can simulate a user id
// that's valid in the live Zitadel org (mockOrgUsers/mockRolesByUserId
// above) but has no tenant_users row yet (never logged in).
let tenantUserIds = new Set(["u-bbb"]);
const mockUpserts: {
  userId: string;
  email: string | null;
  displayName: string | null;
}[] = [];

vi.mock("@platform/teams", () => ({
  validateCrossTenantRefs: async (
    refs: { fieldName: string; refId: string }[],
    lookup: (ids: string[]) => Promise<Set<string>>,
  ) => {
    const validIds = await lookup(refs.map((r) => r.refId));
    return refs
      .filter((r) => !validIds.has(r.refId))
      .map((r) => ({
        field: r.fieldName,
        code: "INVALID_REFERENCE",
        message: "Referenced resource does not exist or is not accessible",
        meta: { refId: r.refId },
      }));
  },
  // Distinguishes the team_id lookup (idColumn "id") from the user-ref
  // lookup (idColumn "userId", used by validateScheduleRefs' B4 fix) -- both
  // now go through this same mocked helper, so a single fixed Set would
  // wrongly reject "u-bbb" against the team_id's valid-id set.
  lookupValidIdsInTable:
    (_tx: unknown, _table: unknown, idColumn: string) => async () =>
      idColumn === "userId"
        ? new Set(tenantUserIds)
        : new Set(["11111111-1111-4111-8111-111111111111"]),
}));

vi.mock("@platform/db", () => ({
  // `db` (the raw, non-tenant-scoped client) is only used by requireAuth(db)
  // at router setup now -- all query logic runs through withTenantContext's
  // tx below, per the RLS-defense-in-depth fix.
  db: {},
  teams: { id: "id", tenantId: "tenantId", deletedAt: "deletedAt" },
  tenantUsers: {
    tenantId: "tenantId",
    userId: "userId",
    displayName: "displayName",
    email: "email",
  },
  onCallSchedules: {
    id: "id",
    tenantId: "tenantId",
    teamId: "teamId",
    startsAt: "startsAt",
    endsAt: "endsAt",
    deletedAt: "deletedAt",
  },
  withTenantContext: (_tenantId: unknown, fn: (tx: unknown) => unknown) => {
    const tx = {
      select: () => tx,
      from: () => tx,
      where: () => tx,
      orderBy: () => tx,
      limit: () => Promise.resolve(getReturnsRow ? [mockScheduleRow] : []),
      insert: () => tx,
      values: (v: {
        userId: string;
        email: string | null;
        displayName: string | null;
      }) => {
        // Only the tenant_users upsert (validateScheduleRefs' Zitadel
        // fallback) passes an object with userId here -- the schedule
        // insert/update .values() calls pass different shapes and never
        // reach .onConflictDoUpdate().
        if (v && typeof v === "object" && "userId" in v) {
          mockUpserts.push(v);
        }
        return tx;
      },
      onConflictDoUpdate: () => Promise.resolve(),
      update: () => tx,
      set: () => tx,
      returning: () => {
        if (overlapConflict) {
          const err = new Error("overlapping range");
          (err as unknown as { cause: { code: string } }).cause = {
            code: "23P01",
          };
          throw err;
        }
        return Promise.resolve([mockScheduleRow]);
      },
      // Makes `await tx.select().from(tenantUsers).where(...)` resolve
      // directly (a chain that stops at .where() rather than continuing to
      // .limit()/.returning()) -- this is the tenantUsers cross-tenant-ref
      // lookup inside validateScheduleRefs, now run under this same tx per
      // the RLS-defense-in-depth fix (PR review). Other call sites move
      // past .where() to .limit()/.returning(), which return real Promises
      // and never trigger this.
      then: (resolve: (v: unknown) => void) => resolve([{ userId: "u-bbb" }]),
    };
    return fn(tx);
  },
}));

vi.mock("@platform/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("@platform/audit", () => ({
  writeAuditEntry: (...args: unknown[]) => {
    mockWriteAuditEntry(...args);
    return Promise.resolve();
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ op: "and", args }),
  eq: (...args: unknown[]) => ({ op: "eq", args }),
  gt: (...args: unknown[]) => ({ op: "gt", args }),
  gte: (...args: unknown[]) => ({ op: "gte", args }),
  lte: (...args: unknown[]) => ({ op: "lte", args }),
  or: (...args: unknown[]) => ({ op: "or", args }),
  inArray: (...args: unknown[]) => ({ op: "inArray", args }),
  asc: (...args: unknown[]) => ({ op: "asc", args }),
  isNull: (...args: unknown[]) => ({ op: "isNull", args }),
}));

const { onCallSchedulesRouter } = await import("./on-call-schedules.js");

function makeApp() {
  const app = new Hono<{ Variables: { auth: AuthContext } }>();
  app.route("/admin/on-call-schedules", onCallSchedulesRouter);
  return app;
}

const validCreateBody = {
  teamId: "11111111-1111-4111-8111-111111111111",
  label: "Week 1",
  startsAt: FUTURE_START.toISOString(),
  endsAt: FUTURE_END.toISOString(),
  primaryUserId: "u-bbb",
};

// Reset shared mutable fixture flags before every test (module-level `let`s
// leak across describe blocks otherwise, per teams.test.ts's fix).
beforeEach(() => {
  mockAuth.roles = ["admin"];
  overlapConflict = false;
  getReturnsRow = true;
  tenantUserIds = new Set(["u-bbb"]);
  mockOrgUsers.length = 0;
  mockRolesByUserId.clear();
  mockUpserts.length = 0;
});

describe("GET /admin/on-call-schedules — role enforcement", () => {
  it("returns 200 for admin role", async () => {
    const res = await makeApp().request("/admin/on-call-schedules");
    expect(res.status).toBe(200);
  });

  it("returns 403 for a role with neither agent nor admin", async () => {
    mockAuth.roles = ["user"];
    const res = await makeApp().request("/admin/on-call-schedules");
    expect(res.status).toBe(403);
  });
});

describe("GET /admin/on-call-schedules/:id", () => {
  it("returns 200 with the schedule when it exists", async () => {
    const res = await makeApp().request(
      `/admin/on-call-schedules/${mockScheduleRow.id}`,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.id).toBe(mockScheduleRow.id);
  });

  it("returns 404 when the schedule does not exist (or belongs to another tenant)", async () => {
    getReturnsRow = false;
    const res = await makeApp().request(
      `/admin/on-call-schedules/${mockScheduleRow.id}`,
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /admin/on-call-schedules", () => {
  it("returns 201 for a valid, non-overlapping window", async () => {
    const res = await makeApp().request("/admin/on-call-schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validCreateBody),
    });
    expect(res.status).toBe(201);
  });

  it("returns 422 when startsAt >= endsAt", async () => {
    const res = await makeApp().request("/admin/on-call-schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validCreateBody,
        startsAt: FUTURE_END.toISOString(),
        endsAt: FUTURE_START.toISOString(),
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 409 when the window overlaps an existing schedule for the team (R5)", async () => {
    overlapConflict = true;
    const res = await makeApp().request("/admin/on-call-schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validCreateBody),
    });
    expect(res.status).toBe(409);
  });

  it("returns 403 for agent role", async () => {
    mockAuth.roles = ["agent"];
    const res = await makeApp().request("/admin/on-call-schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validCreateBody),
    });
    expect(res.status).toBe(403);
  });

  // The bug this covers: GET /admin/members lists agent/admin users straight
  // from the live Zitadel org, so a user who's never logged into OpenWind
  // (and so has no tenant_users row) is still selectable in the roster
  // picker. Before this fix, submitting that id 422'd here even though it
  // was a valid pick.
  it("accepts a primaryUserId that exists in the Zitadel org with an allowed role but has no tenant_users row yet", async () => {
    mockOrgUsers.push({
      userId: "u-new-agent",
      email: "new-agent@example.com",
      displayName: "New Agent",
    });
    mockRolesByUserId.set("u-new-agent", ["agent"]);

    const res = await makeApp().request("/admin/on-call-schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validCreateBody,
        primaryUserId: "u-new-agent",
      }),
    });
    expect(res.status).toBe(201);
    // Self-syncs a tenant_users row so the next lookup/display-name
    // resolution doesn't need to re-hit Zitadel.
    expect(mockUpserts).toEqual([
      {
        tenantId: "t-aaa",
        userId: "u-new-agent",
        email: "new-agent@example.com",
        displayName: "New Agent",
      },
    ]);
  });

  // 2026-09-25: ONCALL_ASSIGNABLE_ROLES was widened to match members.ts'
  // picker (agent/admin/user -- see both files' header comments), so a
  // "user"-role org member is now a valid pick, same as members.ts's own
  // "u-staff-user-role" test case.
  it('accepts a primaryUserId that exists in the Zitadel org holding only the "user" role', async () => {
    mockOrgUsers.push({
      userId: "u-staff-user-role",
      email: "staff@example.com",
      displayName: "Staff Member",
    });
    mockRolesByUserId.set("u-staff-user-role", ["user"]);

    const res = await makeApp().request("/admin/on-call-schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validCreateBody,
        primaryUserId: "u-staff-user-role",
      }),
    });
    expect(res.status).toBe(201);
  });

  it("rejects a primaryUserId that exists in the Zitadel org but holds no role at all", async () => {
    mockOrgUsers.push({
      userId: "u-norole",
      email: "norole@example.com",
      displayName: "No Role",
    });

    const res = await makeApp().request("/admin/on-call-schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validCreateBody, primaryUserId: "u-norole" }),
    });
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.fields).toEqual([
      {
        field: "primaryUserId",
        message: "Referenced resource does not exist or is not accessible",
      },
    ]);
    expect(mockUpserts).toEqual([]);
  });

  it("rejects a primaryUserId that doesn't exist in tenant_users or the Zitadel org", async () => {
    const res = await makeApp().request("/admin/on-call-schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validCreateBody, primaryUserId: "u-ghost" }),
    });
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.fields).toEqual([
      {
        field: "primaryUserId",
        message: "Referenced resource does not exist or is not accessible",
      },
    ]);
    expect(mockUpserts).toEqual([]);
  });
});

describe("PATCH /admin/on-call-schedules/:id — future-window-only (R5)", () => {
  it("returns 200 when the schedule's window has not started yet", async () => {
    const res = await makeApp().request(
      `/admin/on-call-schedules/${mockScheduleRow.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Renamed" }),
      },
    );
    expect(res.status).toBe(200);
  });
});

describe("DELETE /admin/on-call-schedules/:id", () => {
  it("returns 204 on successful soft-delete", async () => {
    const res = await makeApp().request(
      `/admin/on-call-schedules/${mockScheduleRow.id}`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(204);
  });

  it("returns 403 for agent role", async () => {
    mockAuth.roles = ["agent"];
    const res = await makeApp().request(
      `/admin/on-call-schedules/${mockScheduleRow.id}`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(403);
  });
});
