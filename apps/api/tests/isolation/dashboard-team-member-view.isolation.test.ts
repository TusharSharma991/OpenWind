/**
 * Isolation tests for GET /dashboard/team-member-view/:userId
 * (docs/specs/my-org-view.md R13, AuthNexus-fork-only — no core/tushar
 * equivalent).
 *
 * Same shape as dashboard-org-view.isolation.test.ts: the route has no
 * dedicated RLS policy, delegating to resolveUserScopedEntityIds() with the
 * *target* user's id. These tests prove the tenant boundary holds even when
 * the target id is authorized (a real subordinate) but a stale/misconfigured
 * AuthNexus response, or a same-literal-id coincidence across tenants, could
 * otherwise leak another tenant's data.
 *
 * getSubordinateIds/getUserById are mocked (no real AuthNexus call in tests);
 * requireAuth is left real and short-circuits via a pre-populated
 * c.set("auth", ...), same pattern as the org-view isolation tests.
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
const mockGetUserById = vi.fn();
vi.mock("@platform/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof AuthModule>();
  return {
    ...actual,
    getSubordinateIds: (...args: unknown[]) => mockGetSubordinateIds(...args),
    getUserById: (...args: unknown[]) => mockGetUserById(...args),
  };
});

const { teamMemberViewHandler } =
  await import("../../src/routes/dashboard/team-member-view.js");

const TENANT_A = "aaaaaaaa-0000-4000-a000-000000000061";
const TENANT_B = "bbbbbbbb-0000-4000-b000-000000000062";

const MANAGER_A = "manager-a-team-view-test";
const REPORT_A1 = "report-a1-team-view-test";
const USER_B1 = "user-b1-team-view-test";

let entityTypeId: string;
let instanceA1Id: string; // Tenant A, assigned to REPORT_A1
let instanceB1Id: string; // Tenant B, assigned to USER_B1 (same-literal-id trap)

beforeAll(async () => {
  const [etRow] = await db
    .insert(entityTypes)
    .values({
      tenantId: null,
      name: `isolation_team_view_${Date.now()}`,
      plural: `isolation_team_views_${Date.now()}`,
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
  app.get("/team-member-view/:userId", ...teamMemberViewHandler);
  return app;
}

describe("GET /dashboard/team-member-view/:userId — tenant isolation + subordinate authorization", () => {
  it("a manager sees their report's ticket in Tenant A", async () => {
    mockGetSubordinateIds.mockResolvedValue({
      ids: [REPORT_A1],
      hasReports: true,
      status: "ok",
    });
    mockGetUserById.mockResolvedValue(null);

    const res = await makeApp(TENANT_A, MANAGER_A).request(
      `/team-member-view/${REPORT_A1}`,
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { tickets: { items: { entityId: string }[] } };
    };
    expect(data.tickets.items.map((i) => i.entityId)).toContain(instanceA1Id);
  });

  it("404s when the target id is not in the caller's subordinate list, even if it's a real user in the same tenant", async () => {
    mockGetSubordinateIds.mockResolvedValue({
      ids: [], // REPORT_A1 is NOT a subordinate of this caller
      hasReports: false,
      status: "ok",
    });

    const res = await makeApp(TENANT_A, MANAGER_A).request(
      `/team-member-view/${REPORT_A1}`,
    );
    expect(res.status).toBe(404);
  });

  it("Tenant B's ticket never leaks even if AuthNexus authorized a subordinate id matching Tenant B's assignee", async () => {
    // Simulates a misconfigured/stale AuthNexus response — the caller is
    // "authorized" to view USER_B1 (per the mocked subordinate list), but
    // USER_B1 is actually a Tenant B user. The tenant_id filter in
    // resolveUserScopedEntityIds must still exclude Tenant B's ticket.
    mockGetSubordinateIds.mockResolvedValue({
      ids: [USER_B1],
      hasReports: true,
      status: "ok",
    });
    mockGetUserById.mockResolvedValue(null);

    const res = await makeApp(TENANT_A, MANAGER_A).request(
      `/team-member-view/${USER_B1}`,
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { tickets: { items: { entityId: string }[] } };
    };
    const ids = data.tickets.items.map((i) => i.entityId);
    expect(ids).not.toContain(instanceB1Id);
  });

  it("a manager in Tenant B authorized for the same literal subordinate id never sees Tenant A's ticket", async () => {
    mockGetSubordinateIds.mockResolvedValue({
      ids: [REPORT_A1],
      hasReports: true,
      status: "ok",
    });
    mockGetUserById.mockResolvedValue(null);

    const res = await makeApp(TENANT_B, "manager-b-team-view-test").request(
      `/team-member-view/${REPORT_A1}`,
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { tickets: { items: { entityId: string }[] } };
    };
    expect(data.tickets.items.map((i) => i.entityId)).not.toContain(
      instanceA1Id,
    );
  });
});
