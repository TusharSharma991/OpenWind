/**
 * Tenant isolation tests for the admin_audit_log table.
 *
 * The audit log is append-only: app_user has INSERT + SELECT only.
 * RLS USING policy ensures reads are scoped to the current tenant.
 *
 * Requires a live Postgres instance (run with docker compose up -d).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, withTenantContext } from "@platform/db";
import { adminAuditLog } from "@platform/db";
import { queryAuditLog } from "@platform/audit";

// ── Test tenant IDs ───────────────────────────────────────────────────────────

const TENANT_A = "aaaaaaaa-2222-4000-a000-000000000001";
const TENANT_B = "bbbbbbbb-2222-4000-b000-000000000002";

const RESOURCE_ID_A = "aaaaaaaa-2222-4000-a000-000000000100";
const RESOURCE_ID_B = "bbbbbbbb-2222-4000-b000-000000000200";

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await db.insert(adminAuditLog).values([
    {
      tenantId: TENANT_A,
      actorId: "user-a",
      actorType: "user",
      resourceType: "ticket",
      resourceId: RESOURCE_ID_A,
      action: "created",
      beforeSnapshot: null,
      afterSnapshot: { subject: "Tenant A ticket" },
      metadata: null,
    },
    {
      tenantId: TENANT_B,
      actorId: "user-b",
      actorType: "user",
      resourceType: "ticket",
      resourceId: RESOURCE_ID_B,
      action: "created",
      beforeSnapshot: null,
      afterSnapshot: { subject: "Tenant B ticket" },
      metadata: null,
    },
  ]);
});

afterAll(async () => {
  await db.delete(adminAuditLog).where(eq(adminAuditLog.tenantId, TENANT_A));
  await db.delete(adminAuditLog).where(eq(adminAuditLog.tenantId, TENANT_B));
});

// ── READ isolation ────────────────────────────────────────────────────────────

describe("admin_audit_log — cross-tenant READ isolation (RLS)", () => {
  it("Tenant A cannot read Tenant B audit log rows via withTenantContext", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const rows = await tx
        .select({ id: adminAuditLog.id, tenantId: adminAuditLog.tenantId })
        .from(adminAuditLog)
        .where(eq(adminAuditLog.resourceId, RESOURCE_ID_B));
      expect(rows).toHaveLength(0);
    });
  });

  it("Tenant B cannot read Tenant A audit log rows via withTenantContext", async () => {
    await withTenantContext(TENANT_B, async (tx) => {
      const rows = await tx
        .select({ id: adminAuditLog.id })
        .from(adminAuditLog)
        .where(eq(adminAuditLog.resourceId, RESOURCE_ID_A));
      expect(rows).toHaveLength(0);
    });
  });

  it("Tenant A can read its own audit log rows", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const rows = await tx
        .select({
          tenantId: adminAuditLog.tenantId,
          resourceId: adminAuditLog.resourceId,
        })
        .from(adminAuditLog)
        .where(eq(adminAuditLog.resourceId, RESOURCE_ID_A));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.tenantId).toBe(TENANT_A);
    });
  });
});

// ── queryAuditLog API isolation ───────────────────────────────────────────────

describe("queryAuditLog — cross-tenant isolation via @platform/audit API", () => {
  it("returns only Tenant A entries when queried as Tenant A", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const result = await queryAuditLog(tx, {
        tenantId: TENANT_A,
        limit: 100,
      });
      const tenantIds = result.entries.map((e) => e.tenantId);
      expect(tenantIds.every((id) => id === TENANT_A)).toBe(true);
    });
  });

  it("Tenant A query does not expose Tenant B resource IDs", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const result = await queryAuditLog(tx, {
        tenantId: TENANT_A,
        limit: 100,
      });
      const resourceIds = result.entries.map((e) => e.resourceId);
      expect(resourceIds).not.toContain(RESOURCE_ID_B);
    });
  });
});
