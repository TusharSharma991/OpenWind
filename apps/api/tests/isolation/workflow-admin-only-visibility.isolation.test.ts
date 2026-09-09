/**
 * Isolation tests for workflows.adminOnly (migration 0094) — a workflow (and
 * every ticket under it) hidden from anyone but the global "admin" role.
 * Covers the three routes that query entity_instances/workflows directly
 * rather than going through workflow-crud.ts's getWorkflow/listWorkflows
 * choke point, so each needed its own explicit check:
 *   - GET /entities/:id            (get.ts)
 *   - GET /entities                (list.ts)
 *   - GET /entities/:id/children   (list-children.ts)
 *
 * Real Postgres connection, RLS + app_user enforced (not mocked).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import {
  db,
  withTenantContext,
  entityInstances,
  entityTypes,
  workflows,
  workflowStates,
  workflowEvents,
  entityRelations,
} from "@platform/db";
import {
  createEntity,
  createEntityType,
  RELATION_CHILD_OF,
  RELATION_PARENT_OF,
} from "@platform/entity-engine";
import type { AuthContext } from "@platform/auth";
import { getEntityHandler } from "../../src/routes/entities/get.js";
import { listEntitiesHandler } from "../../src/routes/entities/list.js";
import { listChildrenHandler } from "../../src/routes/entities/list-children.js";

const TENANT = "12121212-0000-4000-a000-000000000601";
const CREATOR = "workflow-admin-only-vis-creator";

let entityTypeId: string;
let workflowId: string;
let parentTicketId: string;
let childTicketId: string;

beforeAll(async () => {
  const entityType = await createEntityType(db, null, {
    name: `workflow_admin_only_vis_test_${Date.now()}`,
    plural: "workflow_admin_only_vis_tests",
    allowCustomFields: true,
  });
  entityTypeId = entityType.id;

  const [wf] = await db
    .insert(workflows)
    .values({
      tenantId: TENANT,
      entityTypeId,
      name: "Admin Only Visibility Test Workflow",
      initialState: "open",
      adminOnly: true,
    })
    .returning({ id: workflows.id });
  workflowId = wf!.id;

  await db.insert(workflowStates).values({
    tenantId: TENANT,
    workflowId,
    name: "open",
    label: "Open",
    sortOrder: 0,
  });

  const parent = await withTenantContext(TENANT, (tx) =>
    createEntity(tx, TENANT, {
      entityTypeId,
      workflowId,
      fields: { title: "Admin-only parent" },
      createdBy: CREATOR,
      assignedTo: CREATOR,
      currentState: "open",
    }),
  );
  parentTicketId = parent.id;

  const child = await withTenantContext(TENANT, (tx) =>
    createEntity(tx, TENANT, {
      entityTypeId,
      workflowId,
      fields: { title: "Admin-only child" },
      createdBy: CREATOR,
      currentState: "open",
    }),
  );
  childTicketId = child.id;
  // Wire both relation directions the same way createChildRelation does
  // (listChildInstances reads parent_of; getParentId/getAncestorDepth read
  // child_of) — this suite only needs the read paths to see a non-empty
  // result, it doesn't test the create path itself.
  await db.insert(entityRelations).values([
    {
      tenantId: TENANT,
      fromInstanceId: parentTicketId,
      toInstanceId: childTicketId,
      relationType: RELATION_PARENT_OF,
    },
    {
      tenantId: TENANT,
      fromInstanceId: childTicketId,
      toInstanceId: parentTicketId,
      relationType: RELATION_CHILD_OF,
    },
  ]);
});

afterAll(async () => {
  await db.delete(entityRelations).where(eq(entityRelations.tenantId, TENANT));
  await db
    .delete(workflowEvents)
    .where(eq(workflowEvents.workflowId, workflowId));
  await db
    .delete(entityInstances)
    .where(eq(entityInstances.entityTypeId, entityTypeId));
  await db
    .delete(workflowStates)
    .where(eq(workflowStates.workflowId, workflowId));
  await db.delete(workflows).where(eq(workflows.id, workflowId));
  await db.delete(entityTypes).where(eq(entityTypes.id, entityTypeId));
});

type Vars = { Variables: { auth: AuthContext } };

function makeApp(roles: string[]) {
  const app = new Hono<Vars>();
  app.use("*", async (c: Context<Vars>, next: Next) => {
    c.set("auth", {
      tenantId: TENANT,
      userId: CREATOR,
      roles,
      email: "t@example.com",
    });
    await next();
  });
  app.get("/entities/:id/children", ...listChildrenHandler);
  app.get("/entities/:id", ...getEntityHandler);
  app.get("/entities", ...listEntitiesHandler);
  return app;
}

describe("GET /entities/:id — admin_only workflow", () => {
  it("404s for the ticket's own creator/assignee when they lack the global admin role", async () => {
    const res = await makeApp(["user"]).request(`/entities/${parentTicketId}`);
    expect(res.status).toBe(404);
  });

  it("404s for an agent too — admin_only means the global admin role specifically, not agent", async () => {
    const res = await makeApp(["agent"]).request(`/entities/${parentTicketId}`);
    expect(res.status).toBe(404);
  });

  it("succeeds for a caller with the global admin role", async () => {
    const res = await makeApp(["admin"]).request(`/entities/${parentTicketId}`);
    expect(res.status).toBe(200);
  });
});

describe("GET /entities — admin_only workflow", () => {
  it("404s (ENTITY_TYPE_NOT_FOUND) for a non-global-admin caller listing this entity type", async () => {
    const res = await makeApp(["user"]).request(
      `/entities?entityTypeId=${entityTypeId}`,
    );
    expect(res.status).toBe(404);
  });

  it("succeeds for a caller with the global admin role", async () => {
    const res = await makeApp(["admin"]).request(
      `/entities?entityTypeId=${entityTypeId}`,
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { id: string }[] };
    expect(data.map((r) => r.id)).toContain(parentTicketId);
  });
});

describe("GET /entities/:id/children — admin_only workflow", () => {
  it("404s for the parent's own creator when they lack the global admin role", async () => {
    const res = await makeApp(["user"]).request(
      `/entities/${parentTicketId}/children`,
    );
    expect(res.status).toBe(404);
  });

  it("succeeds for a caller with the global admin role", async () => {
    const res = await makeApp(["admin"]).request(
      `/entities/${parentTicketId}/children`,
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { id: string }[] };
    expect(data.map((r) => r.id)).toContain(childTicketId);
  });
});
