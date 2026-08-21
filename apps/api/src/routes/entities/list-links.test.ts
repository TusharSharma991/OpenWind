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
}));

const mockInstanceResult: Record<string, unknown>[] = [];
const mockLinksResult: Record<string, unknown>[] = [];

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
  withTenantContext: (_tenantId: string, fn: (tx: unknown) => unknown) =>
    fn({
      select: vi.fn((_cols: Record<string, unknown>) => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn().mockResolvedValue(mockLinksResult),
            limit: vi.fn().mockResolvedValue(mockInstanceResult),
          })),
        })),
      })),
    }),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conds: unknown[]) => ({ op: "and", conds }),
  eq: (col: unknown, val: unknown) => ({ col, val, op: "eq" }),
}));

const { listLinksHandler } = await import("./list-links.js");

function makeApp() {
  const app = new Hono<{ Variables: { auth: AuthContext } }>();
  app.get("/:id/links", ...listLinksHandler);
  return app;
}

const INST_ID = "00000000-0000-0000-0000-000000000002";

const fakeLinkRow = {
  id: "link-1",
  title: "ERP record",
  url: "https://erp.example.com/record/123",
  createdBy: "u-bbb",
  createdAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockInstanceResult.length = 0;
  mockLinksResult.length = 0;
  mockAuth = {
    tenantId: "t-aaa",
    userId: "u-bbb",
    roles: ["agent"],
    email: "test@example.com",
  };
});

describe("GET /entities/:id/links", () => {
  it("returns 404 when the record does not exist", async () => {
    const res = await makeApp().request(`/${INST_ID}/links`);
    expect(res.status).toBe(404);
  });

  it("returns 200 with links for a privileged (agent) caller", async () => {
    mockInstanceResult.push({
      id: INST_ID,
      createdBy: null,
      assignedTo: null,
      fields: {},
      workflowId: null,
    });
    mockLinksResult.push(fakeLinkRow);

    const res = await makeApp().request(`/${INST_ID}/links`);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].title).toBe("ERP record");
  });

  it("returns 404 for a non-privileged user with no relation to a restricted record", async () => {
    mockAuth = {
      tenantId: "t-aaa",
      userId: "u-outsider",
      roles: ["user"],
      email: "outsider@example.com",
    };
    mockInstanceResult.push({
      id: INST_ID,
      createdBy: "u-owner",
      assignedTo: "u-other",
      fields: {},
      workflowId: null,
    });
    mockLinksResult.push(fakeLinkRow);

    const res = await makeApp().request(`/${INST_ID}/links`);

    expect(res.status).toBe(404);
  });

  it("returns 200 for a non-privileged user who is the assignee", async () => {
    mockAuth = {
      tenantId: "t-aaa",
      userId: "u-assignee",
      roles: ["user"],
      email: "assignee@example.com",
    };
    mockInstanceResult.push({
      id: INST_ID,
      createdBy: "u-owner",
      assignedTo: "u-assignee",
      fields: {},
      workflowId: null,
    });
    mockLinksResult.push(fakeLinkRow);

    const res = await makeApp().request(`/${INST_ID}/links`);

    expect(res.status).toBe(200);
  });
});
