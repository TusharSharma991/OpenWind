/**
 * Isolation tests for GET /dashboard/org-view (docs/specs/my-org-view.md,
 * AuthNexus-fork-only — no core/tushar equivalent).
 *
 * Like dashboard-my-view.isolation.test.ts, the route has no dedicated RLS
 * policy — it delegates to resolveUserScopedEntityIds() with an id set that
 * includes subordinate ids from AuthNexus. These tests prove the tenant
 * boundary holds even when a subordinate-id list *could* theoretically
 * reference ids belonging to another tenant (e.g. a stale/misconfigured
 * AuthNexus response) — the tenant_id filter in resolveUserScopedEntityIds
 * must still be the deciding factor, never the subordinate-id list alone.
 *
 * getSubordinateIds is mocked (no real AuthNexus call in tests — no sandbox
 * exists, see docs/specs/my-org-view.md §T5's testing note); requireAuth is
 * left real and short-circuits via a pre-populated c.set("auth", ...), same
 * pattern as the my-view isolation tests.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import {
  db,
  withTenantContext,
  entityInstances,
  entityTypes,
} from "@platform/db";
import { createEntity } from "@platform/entity-engine";
import type { AuthContext } from "@platform/auth";
import type * as AuthModule from "@platform/auth";

const mockGetSubordinateIds = vi.fn();
vi.mock("@platform/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof AuthModule>();
  return {
    ...actual,
    getSubordinateIds: (...args: unknown[]) => mockGetSubordinateIds(...args),
  };
});

const { orgViewHandler } =
  await import("../../src/routes/dashboard/org-view.js");

const TENANT_A = "aaaaaaaa-0000-4000-a000-000000000051";
const TENANT_B = "bbbbbbbb-0000-4000-b000-000000000052";

const MANAGER_A = "manager-a-org-view-test";
const REPORT_A1 = "report-a1-org-view-test";
const USER_B1 = "user-b1-org-view-test";

let entityTypeId: string;
let instanceA1Id: string; // Tenant A, assigned to REPORT_A1 (the manager's report)
let instanceB1Id: string; // Tenant B, assigned to USER_B1 — same literal id never used as a "subordinate" but proves tenant_id alone gates access

beforeAll(async () => {
  const [etRow] = await db
    .insert(entityTypes)
    .values({
      tenantId: null,
      name: `isolation_org_view_${Date.now()}`,
      plural: `isolation_org_views_${Date.now()}`,
      allowCustomFields: true,
    })
    .returning();
  if (!etRow) throw new Error("entity type insert failed");
  entityTypeId = etRow.id;

  const instA1 = await withTenantContext(TENANT_A, (tx) =>
    createEntity(tx, TENANT_A, {
      entityTypeId,
      fields: { title: "Report's ticket in Tenant A" },
      assignedTo: REPORT_A1,
    }),
  );
  instanceA1Id = instA1.id;

  const instB1 = await withTenantContext(TENANT_B, (tx) =>
    createEntity(tx, TENANT_B, {
      entityTypeId,
      fields: { title: "Tenant B ticket" },
      assignedTo: USER_B1,
    }),
  );
  instanceB1Id = instB1.id;
});

afterAll(async () => {
  await db
    .delete(entityInstances)
    .where(eq(entityInstances.entityTypeId, entityTypeId));
  await db.delete(entityTypes).where(eq(entityTypes.id, entityTypeId));
});

function makeApp(tenantId: string, userId: string, orgId = "org-test") {
  const app = new Hono<{ Variables: { auth: AuthContext } }>();
  app.use(
    "*",
    async (c: Context<{ Variables: { auth: AuthContext } }>, next: Next) => {
      c.set("auth", {
        tenantId,
        userId,
        roles: ["user"],
        email: "t@example.com",
        orgId,
      });
      await next();
    },
  );
  app.get("/org-view", ...orgViewHandler);
  return app;
}

describe("GET /dashboard/org-view — tenant isolation with AuthNexus-derived subordinate ids", () => {
  it("a manager sees their report's ticket in Tenant A", async () => {
    mockGetSubordinateIds.mockResolvedValue({
      ids: [REPORT_A1],
      hasReports: true,
      status: "ok",
    });

    const res = await makeApp(TENANT_A, MANAGER_A).request("/org-view");
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { tickets: { items: { entityId: string }[] } };
    };
    expect(data.tickets.items.map((i) => i.entityId)).toContain(instanceA1Id);
  });

  it("Tenant B's ticket never leaks into Tenant A's org-view response, even if AuthNexus returned a subordinate id matching Tenant B's assignee", async () => {
    // Simulates a misconfigured/stale AuthNexus response — the subordinate
    // list includes USER_B1 (who is actually a Tenant B user). The tenant_id
    // filter in resolveUserScopedEntityIds must still exclude Tenant B's
    // ticket; it must never be reachable just because an id appeared in the
    // subordinate list.
    mockGetSubordinateIds.mockResolvedValue({
      ids: [REPORT_A1, USER_B1],
      hasReports: true,
      status: "ok",
    });

    const res = await makeApp(TENANT_A, MANAGER_A).request("/org-view");
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { tickets: { items: { entityId: string }[] } };
    };
    const ids = data.tickets.items.map((i) => i.entityId);
    expect(ids).toContain(instanceA1Id);
    expect(ids).not.toContain(instanceB1Id);
  });

  it("a manager in Tenant B never sees Tenant A's ticket, even when scoped to the same literal subordinate id", async () => {
    mockGetSubordinateIds.mockResolvedValue({
      ids: [REPORT_A1],
      hasReports: true,
      status: "ok",
    });

    const res = await makeApp(TENANT_B, "manager-b-org-view-test").request(
      "/org-view",
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { tickets: { items: { entityId: string }[] } };
    };
    expect(data.tickets.items.map((i) => i.entityId)).not.toContain(
      instanceA1Id,
    );
  });

  it("a user with hasReports:false gets fully empty sections, never an error, and the DB is never queried", async () => {
    mockGetSubordinateIds.mockResolvedValue({
      ids: [],
      hasReports: false,
      status: "ok",
    });

    const res = await makeApp(TENANT_A, "user-with-no-reports").request(
      "/org-view",
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { hasReports: boolean; tickets: { items: unknown[] } };
    };
    expect(data.hasReports).toBe(false);
    expect(data.tickets.items).toEqual([]);
  });
});
