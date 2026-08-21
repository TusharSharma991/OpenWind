import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import type { AuthContext } from "@platform/auth";

let mockAuth: AuthContext = {
  tenantId: "t-aaa",
  userId: "u-bbb",
  roles: ["agent"],
  email: "test@example.com",
};

vi.mock("@platform/auth", () => ({
  requireAuth:
    () =>
    async (c: Context<{ Variables: { auth: AuthContext } }>, next: Next) => {
      c.set("auth", mockAuth);
      await next();
    },
  requireRole:
    (..._roles: string[]) =>
    async (_c: Context, next: Next) => {
      await next();
    },
}));

vi.mock("@platform/workflow-engine", () => ({
  getWorkflow: vi.fn().mockResolvedValue(null),
  isWorkflowAdmin: vi.fn().mockReturnValue(false),
}));

const mockInstanceResult: Record<string, unknown>[] = [];
const mockInsertedLink: Record<string, unknown>[] = [];

vi.mock("@platform/db", () => ({
  entityInstances: {
    id: "entity_instances.id",
    tenantId: "entity_instances.tenant_id",
    createdBy: "entity_instances.created_by",
    assignedTo: "entity_instances.assigned_to",
    fields: "entity_instances.fields",
    workflowId: "entity_instances.workflow_id",
  },
  entityLinks: {
    id: "entity_links.id",
    tenantId: "entity_links.tenant_id",
    entityId: "entity_links.entity_id",
    title: "entity_links.title",
    url: "entity_links.url",
    createdBy: "entity_links.created_by",
    createdAt: "entity_links.created_at",
  },
  entityRelations: {
    fromInstanceId: "entity_relations.from_instance_id",
    toInstanceId: "entity_relations.to_instance_id",
    tenantId: "entity_relations.tenant_id",
    relationType: "entity_relations.relation_type",
    deletedAt: "entity_relations.deleted_at",
  },
  workflowEvents: {},
  withTenantContext: (_tenantId: string, fn: (tx: unknown) => unknown) =>
    fn({
      // Only the instance lookup and the parent-relation fallback lookup
      // (when workflowId is null) ever select() in this handler — both are
      // satisfied by the same queue here since the success-path tests below
      // set a non-null workflowId, which skips the fallback entirely.
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue(mockInstanceResult),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue(mockInsertedLink),
        })),
      })),
    }),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conds: unknown[]) => ({ op: "and", conds }),
  eq: (col: unknown, val: unknown) => ({ col, val, op: "eq" }),
  isNull: (col: unknown) => ({ col, op: "isNull" }),
}));

const { createLinkHandler } = await import("./create-link.js");

function makeApp() {
  const app = new Hono<{ Variables: { auth: AuthContext } }>();
  app.post("/:id/links", ...createLinkHandler);
  return app;
}

const INST_ID = "00000000-0000-0000-0000-000000000002";

beforeEach(() => {
  vi.clearAllMocks();
  mockInstanceResult.length = 0;
  mockInsertedLink.length = 0;
  mockAuth = {
    tenantId: "t-aaa",
    userId: "u-bbb",
    roles: ["agent"],
    email: "test@example.com",
  };
});

describe("POST /entities/:id/links", () => {
  it("returns 404 when the record does not exist", async () => {
    const res = await makeApp().request(`/${INST_ID}/links`, {
      method: "POST",
      body: JSON.stringify({ title: "Doc", url: "https://example.com" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 for an invalid URL", async () => {
    mockInstanceResult.push({
      id: INST_ID,
      workflowId: null,
      createdBy: null,
      assignedTo: null,
      fields: {},
    });

    const res = await makeApp().request(`/${INST_ID}/links`, {
      method: "POST",
      body: JSON.stringify({ title: "Doc", url: "not-a-url" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  it("creates a link for a privileged (agent) caller", async () => {
    mockInstanceResult.push({
      id: INST_ID,
      // Non-null so the history-event write takes the direct path, not the
      // parent-relation fallback lookup (a separate select() shape this
      // suite's mock doesn't model).
      workflowId: "wf-1",
      currentState: "open",
      createdBy: null,
      assignedTo: null,
      fields: {},
    });
    mockInsertedLink.push({
      id: "link-1",
      title: "ERP record",
      url: "https://erp.example.com/record/123",
      createdBy: "u-bbb",
      createdAt: new Date(),
    });

    const res = await makeApp().request(`/${INST_ID}/links`, {
      method: "POST",
      body: JSON.stringify({
        title: "ERP record",
        url: "https://erp.example.com/record/123",
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.title).toBe("ERP record");
  });

  it("returns 404 for a non-privileged user with no relation to the record", async () => {
    mockAuth = {
      tenantId: "t-aaa",
      userId: "u-outsider",
      roles: ["user"],
      email: "outsider@example.com",
    };
    mockInstanceResult.push({
      id: INST_ID,
      workflowId: null,
      createdBy: "u-owner",
      assignedTo: "u-other",
      fields: {},
    });

    const res = await makeApp().request(`/${INST_ID}/links`, {
      method: "POST",
      body: JSON.stringify({ title: "Doc", url: "https://example.com" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(404);
  });

  it("allows a non-privileged assignee to add a link", async () => {
    mockAuth = {
      tenantId: "t-aaa",
      userId: "u-assignee",
      roles: ["user"],
      email: "assignee@example.com",
    };
    mockInstanceResult.push({
      id: INST_ID,
      workflowId: "wf-1",
      currentState: "open",
      createdBy: "u-owner",
      assignedTo: "u-assignee",
      fields: {},
    });
    mockInsertedLink.push({
      id: "link-1",
      title: "Doc",
      url: "https://example.com",
      createdBy: "u-assignee",
      createdAt: new Date(),
    });

    const res = await makeApp().request(`/${INST_ID}/links`, {
      method: "POST",
      body: JSON.stringify({ title: "Doc", url: "https://example.com" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(201);
  });
});
