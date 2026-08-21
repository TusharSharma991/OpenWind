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

const mockDeleteWhere = vi.fn();

vi.mock("@platform/db", () => ({
  entityInstances: {
    id: "entity_instances.id",
    tenantId: "entity_instances.tenant_id",
    workflowId: "entity_instances.workflow_id",
  },
  entityLinks: {
    id: "entity_links.id",
    tenantId: "entity_links.tenant_id",
    entityId: "entity_links.entity_id",
    createdBy: "entity_links.created_by",
  },
  entityRelations: {
    fromInstanceId: "entity_relations.from_instance_id",
    toInstanceId: "entity_relations.to_instance_id",
    tenantId: "entity_relations.tenant_id",
    relationType: "entity_relations.relation_type",
    deletedAt: "entity_relations.deleted_at",
  },
  workflowEvents: {},
  // Real body is installed per-test by withQueues() below — the handler
  // makes two sequential select() calls (instance, then link) that need
  // different result queues, which a single static factory can't route by
  // column shape alone.
  withTenantContext: () => {
    throw new Error("withTenantContext not configured — call withQueues()");
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...conds: unknown[]) => ({ op: "and", conds }),
  eq: (col: unknown, val: unknown) => ({ col, val, op: "eq" }),
  isNull: (col: unknown) => ({ col, op: "isNull" }),
}));

const db = await import("@platform/db");

function withQueues(instanceRows: unknown[], linkRows: unknown[]) {
  let call = 0;
  (
    db as unknown as {
      withTenantContext: (
        tenantId: string,
        fn: (tx: unknown) => unknown,
      ) => unknown;
    }
  ).withTenantContext = (_tenantId: string, fn: (tx: unknown) => unknown) =>
    fn({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockImplementation(() => {
              call += 1;
              return Promise.resolve(call === 1 ? instanceRows : linkRows);
            }),
          })),
        })),
      })),
      delete: vi.fn(() => ({
        where: (...args: unknown[]) => {
          mockDeleteWhere(...args);
          return Promise.resolve([]);
        },
      })),
      insert: vi.fn(() => ({
        values: vi.fn().mockResolvedValue(undefined),
      })),
    });
}

const { deleteLinkHandler } = await import("./delete-link.js");

function makeApp() {
  const app = new Hono<{ Variables: { auth: AuthContext } }>();
  app.delete("/:id/links/:linkId", ...deleteLinkHandler);
  return app;
}

const INST_ID = "00000000-0000-0000-0000-000000000002";
const LINK_ID = "link-1";

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth = {
    tenantId: "t-aaa",
    userId: "u-bbb",
    roles: ["agent"],
    email: "test@example.com",
  };
});

describe("DELETE /entities/:id/links/:linkId", () => {
  it("returns 404 when the record does not exist", async () => {
    withQueues([], []);
    const res = await makeApp().request(`/${INST_ID}/links/${LINK_ID}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 when the link does not exist", async () => {
    withQueues([{ id: INST_ID, workflowId: null }], []);
    const res = await makeApp().request(`/${INST_ID}/links/${LINK_ID}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 when the link belongs to a different entity", async () => {
    withQueues(
      [{ id: INST_ID, workflowId: null }],
      [{ id: LINK_ID, entityId: "other-entity", createdBy: "u-bbb" }],
    );
    const res = await makeApp().request(`/${INST_ID}/links/${LINK_ID}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });

  it("deletes the link for a privileged (agent) caller", async () => {
    withQueues(
      // Non-null workflowId so the history-event write takes the direct
      // path, not the parent-relation fallback lookup.
      [{ id: INST_ID, workflowId: "wf-1", currentState: "open" }],
      [{ id: LINK_ID, entityId: INST_ID, createdBy: "someone-else" }],
    );
    const res = await makeApp().request(`/${INST_ID}/links/${LINK_ID}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(204);
  });

  it("returns 404 for a non-privileged user who didn't create the link", async () => {
    mockAuth = {
      tenantId: "t-aaa",
      userId: "u-outsider",
      roles: ["user"],
      email: "outsider@example.com",
    };
    withQueues(
      [{ id: INST_ID, workflowId: null }],
      [{ id: LINK_ID, entityId: INST_ID, createdBy: "someone-else" }],
    );
    const res = await makeApp().request(`/${INST_ID}/links/${LINK_ID}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });

  it("allows the link's own creator to delete it even without a privileged role", async () => {
    mockAuth = {
      tenantId: "t-aaa",
      userId: "u-creator",
      roles: ["user"],
      email: "creator@example.com",
    };
    withQueues(
      [{ id: INST_ID, workflowId: "wf-1", currentState: "open" }],
      [{ id: LINK_ID, entityId: INST_ID, createdBy: "u-creator" }],
    );
    const res = await makeApp().request(`/${INST_ID}/links/${LINK_ID}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(204);
  });

  it("allows the ticket's assignee to delete a link they didn't add", async () => {
    mockAuth = {
      tenantId: "t-aaa",
      userId: "u-assignee",
      roles: ["user"],
      email: "assignee@example.com",
    };
    withQueues(
      [
        {
          id: INST_ID,
          workflowId: "wf-1",
          currentState: "open",
          createdBy: "u-owner",
          assignedTo: "u-assignee",
        },
      ],
      [{ id: LINK_ID, entityId: INST_ID, createdBy: "someone-else" }],
    );
    const res = await makeApp().request(`/${INST_ID}/links/${LINK_ID}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(204);
  });

  it("returns 404 for a non-privileged, non-owner user even if they're not the outsider case above", async () => {
    mockAuth = {
      tenantId: "t-aaa",
      userId: "u-bystander",
      roles: ["user"],
      email: "bystander@example.com",
    };
    withQueues(
      [
        {
          id: INST_ID,
          workflowId: "wf-1",
          currentState: "open",
          createdBy: "u-owner",
          assignedTo: "u-assignee",
        },
      ],
      [{ id: LINK_ID, entityId: INST_ID, createdBy: "someone-else" }],
    );
    const res = await makeApp().request(`/${INST_ID}/links/${LINK_ID}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });
});
