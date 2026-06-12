import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Hono } from "hono";
import type { Context, Next } from "hono";
import type { AuthContext } from "@platform/auth";
import { eq } from "drizzle-orm";
import {
  db,
  tenants,
  entityTypes,
  entityFields,
  workflows,
  workflowStates,
  workflowTransitions,
  automationRules,
} from "@platform/db";
import { ModuleService } from "../../src/services/module-service.js";
import { createApp } from "../../src/app.js";

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000000099";

vi.mock("@platform/auth", () => ({
  requireAuth:
    () =>
    async (
      c: Context<{ Variables: { auth: AuthContext } }>,
      next: Next,
    ): Promise<void> => {
      c.set("auth", {
        tenantId: TEST_TENANT_ID,
        userId: "u-test-admin",
        roles: ["admin"],
        email: "admin@test.com",
      });
      await next();
    },
  requireRole:
    (..._roles: string[]) =>
    async (c: Context, next: Next): Promise<void> => {
      await next();
    },
  requireIntrospection:
    () =>
    async (c: Context, next: Next): Promise<void> => {
      await next();
    },
}));

describe("Module System Integration Tests", () => {
  let app: Hono;

  beforeAll(async () => {
    // 1. Create a test tenant
    await db
      .insert(tenants)
      .values({
        id: TEST_TENANT_ID,
        name: "Test Module Tenant",
        slug: "test-module-tenant",
        plan: "standard",
        status: "active",
        config: {},
      })
      .onConflictDoNothing();

    // 2. Instantiate Hono app
    app = createApp();

    // 3. Populate modules registry
    await ModuleService.seedRegistry();
  });

  afterAll(async () => {
    // Clean up test data
    await db
      .delete(automationRules)
      .where(eq(automationRules.tenantId, TEST_TENANT_ID));

    // Since workflows/states/transitions reference each other, delete in reverse order
    const [wf] = await db
      .select()
      .from(workflows)
      .where(eq(workflows.tenantId, TEST_TENANT_ID))
      .limit(1);

    if (wf) {
      await db
        .delete(workflowTransitions)
        .where(eq(workflowTransitions.workflowId, wf.id));
      await db
        .delete(workflowStates)
        .where(eq(workflowStates.workflowId, wf.id));
      await db.delete(workflows).where(eq(workflows.id, wf.id));
    }

    await db
      .delete(entityFields)
      .where(eq(entityFields.tenantId, TEST_TENANT_ID));
    await db
      .delete(entityTypes)
      .where(eq(entityTypes.tenantId, TEST_TENANT_ID));
    await db.delete(tenants).where(eq(tenants.id, TEST_TENANT_ID));
  });

  it("GET /modules - lists registered modules with installed=false status", async () => {
    const res = await app.request("/modules", { method: "GET" });
    expect(res.status).toBe(200);
    const { data: json } = (await res.json()) as {
      data: { slug: string; installed: boolean }[];
    };
    expect(json.length).toBeGreaterThanOrEqual(1);

    const helpdesk = json.find((m) => m.slug === "helpdesk");
    expect(helpdesk).toBeDefined();
    expect(helpdesk?.installed).toBe(false);
  });

  it("POST /modules/helpdesk/install - successfully installs helpdesk module and runs seed SQL", async () => {
    const res = await app.request("/modules/helpdesk/install", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe("success");

    // Verify tenant config has 'helpdesk'
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, TEST_TENANT_ID))
      .limit(1);
    expect(
      (tenant.config as Record<string, unknown>)["installed_modules"],
    ).toContain("helpdesk");

    // Verify entity types created
    const types = await db
      .select()
      .from(entityTypes)
      .where(eq(entityTypes.tenantId, TEST_TENANT_ID));
    expect(types.map((t) => t.name)).toContain("ticket");
    expect(types.map((t) => t.name)).toContain("comment");
    expect(types.map((t) => t.name)).toContain("article");

    const ticketType = types.find((t) => t.name === "ticket")!;

    // Verify entity fields created
    const fields = await db
      .select()
      .from(entityFields)
      .where(eq(entityFields.tenantId, TEST_TENANT_ID));
    const ticketFields = fields.filter((f) => f.entityTypeId === ticketType.id);
    expect(ticketFields.map((f) => f.name)).toContain("title");
    expect(ticketFields.map((f) => f.name)).toContain("description");
    expect(ticketFields.map((f) => f.name)).toContain("priority");
    expect(ticketFields.map((f) => f.name)).toContain("category");

    // Verify workflow created
    const wfs = await db
      .select()
      .from(workflows)
      .where(eq(workflows.tenantId, TEST_TENANT_ID));
    expect(wfs.map((w) => w.name)).toContain("ticket_workflow");
    const wf = wfs.find((w) => w.name === "ticket_workflow")!;

    // Verify workflow states created
    const states = await db
      .select()
      .from(workflowStates)
      .where(eq(workflowStates.workflowId, wf.id));
    expect(states.map((s) => s.name)).toContain("open");
    expect(states.map((s) => s.name)).toContain("in_progress");
    expect(states.map((s) => s.name)).toContain("pending");
    expect(states.map((s) => s.name)).toContain("resolved");

    // Verify workflow transitions created
    const transitions = await db
      .select()
      .from(workflowTransitions)
      .where(eq(workflowTransitions.workflowId, wf.id));
    expect(transitions.length).toBe(4);

    // Verify automation rule created
    const rules = await db
      .select()
      .from(automationRules)
      .where(eq(automationRules.tenantId, TEST_TENANT_ID));
    expect(rules.map((r) => r.name)).toContain(
      "Auto-set default priority on ticket creation",
    );
  });

  it("GET /modules - shows helpdesk as installed", async () => {
    const res = await app.request("/modules", { method: "GET" });
    expect(res.status).toBe(200);
    const { data: json } = (await res.json()) as {
      data: { slug: string; installed: boolean }[];
    };
    const helpdesk = json.find((m) => m.slug === "helpdesk");
    expect(helpdesk?.installed).toBe(true);
  });

  it("POST /modules/helpdesk/uninstall - uninstalls helpdesk module, config list updated", async () => {
    const res = await app.request("/modules/helpdesk/uninstall", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe("success");

    // Verify tenant config has 'helpdesk' removed
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, TEST_TENANT_ID))
      .limit(1);
    expect(
      (tenant.config as Record<string, unknown>)["installed_modules"],
    ).not.toContain("helpdesk");

    // Verify listing shows not installed
    const listRes = await app.request("/modules", { method: "GET" });
    const { data: listJson } = (await listRes.json()) as {
      data: { slug: string; installed: boolean }[];
    };
    const helpdesk = listJson.find((m) => m.slug === "helpdesk");
    expect(helpdesk?.installed).toBe(false);
  });
});
