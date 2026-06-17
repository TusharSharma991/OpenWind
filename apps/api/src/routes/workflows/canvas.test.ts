import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import type { AuthContext } from "@platform/auth";
import type * as WorkflowEngine from "@platform/workflow-engine";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockGetWorkflow = vi.fn();
const mockInsertStates = vi.fn().mockResolvedValue([]);
const mockInsertTransitions = vi.fn().mockResolvedValue([]);
const mockUpdateStates = vi.fn().mockResolvedValue([]);
const mockUpdateTransitions = vi.fn().mockResolvedValue([]);
const mockDeleteTransitions = vi.fn().mockResolvedValue([]);
const mockDeleteStates = vi.fn().mockResolvedValue([]);

vi.mock("@platform/auth", () => ({
  requireAuth:
    () =>
    async (c: Context<{ Variables: { auth: AuthContext } }>, next: Next) => {
      c.set("auth", {
        tenantId: "t-aaa",
        userId: "u-bbb",
        roles: ["admin"],
        email: "test@example.com",
      });
      await next();
    },
  requireRole: () => async (_c: Context, next: Next) => {
    await next();
  },
}));

const chainable = {
  where: () => chainable,
  set: () => chainable,
  values: () => chainable,
  returning: () => Promise.resolve([]),
};

vi.mock("@platform/db", () => ({
  withTenantContext: (_tenantId: string, fn: (tx: unknown) => unknown) =>
    fn({
      select: () => ({
        from: () => ({ where: () => ({ orderBy: () => Promise.resolve([]) }) }),
      }),
      insert: (table: unknown) => {
        if (String(table).includes("States")) mockInsertStates();
        else mockInsertTransitions();
        return { values: () => Promise.resolve() };
      },
      update: (table: unknown) => {
        if (String(table).includes("States")) mockUpdateStates();
        else mockUpdateTransitions();
        return chainable;
      },
      delete: (table: unknown) => {
        if (String(table).includes("States")) mockDeleteStates();
        else mockDeleteTransitions();
        return chainable;
      },
    }),
  workflowStates: "workflowStates",
  workflowTransitions: "workflowTransitions",
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (a: unknown, b: unknown) => ({ a, b }),
  inArray: (a: unknown, b: unknown) => ({ a, b }),
}));

vi.mock("@platform/workflow-engine", async (importOriginal) => {
  const real = await importOriginal<typeof WorkflowEngine>();
  return {
    ...real,
    getWorkflow: (...args: unknown[]) => mockGetWorkflow(...args),
  };
});

vi.mock("@platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { canvasSaveHandler } = await import("./canvas.js");

// ── Fixtures ──────────────────────────────────────────────────────────────────

const WF_ID = "00000000-0000-0000-0000-000000000010";

const BASE_WORKFLOW = {
  id: WF_ID,
  name: "Support",
  entityTypeId: "etype-1",
  initialState: "open",
  isActive: true,
  createdAt: new Date().toISOString(),
  states: [
    {
      id: "s-open",
      name: "open",
      label: "Open",
      color: null,
      isTerminal: false,
      slaHours: null,
      sortOrder: 0,
    },
    {
      id: "s-closed",
      name: "closed",
      label: "Closed",
      color: null,
      isTerminal: true,
      slaHours: null,
      sortOrder: 1,
    },
  ],
  transitions: [
    {
      id: "t-1",
      fromState: "open",
      toState: "closed",
      label: "Close",
      allowedRoles: [],
      requiresComment: false,
      requiresFields: [],
      conditions: null,
      workflowId: WF_ID,
    },
  ],
};

function makeApp() {
  const app = new Hono();
  app.put("/:id/canvas", ...canvasSaveHandler);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PUT /workflows/:id/canvas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWorkflow.mockResolvedValue(BASE_WORKFLOW);
  });

  it("returns 200 with updated workflow on clean save", async () => {
    const app = makeApp();
    const res = await app.request(`/${WF_ID}/canvas`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        states: BASE_WORKFLOW.states,
        transitions: [
          {
            id: "t-1",
            fromState: "open",
            toState: "closed",
            label: "Close",
            allowedRoles: [],
            requiresComment: false,
            requiresFields: [],
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown };
    expect(body).toHaveProperty("data");
  });

  it("returns 400 on invalid body", async () => {
    const app = makeApp();
    const res = await app.request(`/${WF_ID}/canvas`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ states: "bad" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 200 when adding a new state (temp id)", async () => {
    const app = makeApp();
    const res = await app.request(`/${WF_ID}/canvas`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        states: [
          ...BASE_WORKFLOW.states,
          {
            id: "__new_1",
            name: "pending",
            label: "Pending",
            color: null,
            isTerminal: false,
            slaHours: null,
            sortOrder: 2,
          },
        ],
        transitions: [],
      }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 404 when workflow not found", async () => {
    mockGetWorkflow.mockRejectedValueOnce(
      Object.assign(new Error("not found"), {
        name: "WorkflowError",
        code: "WORKFLOW_NOT_FOUND",
      }),
    );
    const app = makeApp();
    const res = await app.request(`/${WF_ID}/canvas`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ states: [], transitions: [] }),
    });
    expect(res.status).toBe(404);
  });
});
