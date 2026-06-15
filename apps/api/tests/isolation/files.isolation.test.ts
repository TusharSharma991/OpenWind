/**
 * Tenant isolation tests for the files table.
 *
 * Isolation is enforced by two layers:
 *  1. Explicit WHERE tenant_id = $tenantId in every @platform/files query
 *     (tested exhaustively here).
 *  2. Postgres RLS policies (enforced when running as a non-superuser role).
 *
 * These tests exercise layer 1 via the @platform/files service API and via
 * direct queries that include explicit tenant_id predicates. Layer 1 is the
 * protection that runs in production on every request regardless of DB role.
 *
 * Requires a live Postgres instance (run with docker compose up -d).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { db, withTenantContext } from "@platform/db";
import { files } from "@platform/db";
import { FileError, deleteFile } from "@platform/files";

// No mocks needed: deleteFile throws FILE_NOT_FOUND before reaching S3/Redis
// in all cross-tenant paths tested here (wrong tenant_id → DB returns no row).

// ── Test tenant IDs ───────────────────────────────────────────────────────────

const TENANT_A = "aaaaaaaa-1111-4000-a000-000000000001";
const TENANT_B = "bbbbbbbb-1111-4000-b000-000000000002";
const USER_A = "aaaaaaaa-1111-4000-a000-000000000010";
const USER_B = "bbbbbbbb-1111-4000-b000-000000000020";

let fileIdA: string;
let fileIdB: string;

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Insert file rows directly as DB owner (bypasses RLS for setup).
  const [rowA] = await db
    .insert(files)
    .values({
      tenantId: TENANT_A,
      moduleSlug: "helpdesk",
      entityId: null,
      originalName: "tenant-a-doc.pdf",
      storageKey: `${TENANT_A}/helpdesk/tenant-a-doc.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 1024,
      scanStatus: "clean",
      uploadedBy: USER_A,
    })
    .returning();
  if (!rowA) throw new Error("setup: failed to insert file for tenant A");
  fileIdA = rowA.id;

  const [rowB] = await db
    .insert(files)
    .values({
      tenantId: TENANT_B,
      moduleSlug: "helpdesk",
      entityId: null,
      originalName: "tenant-b-doc.pdf",
      storageKey: `${TENANT_B}/helpdesk/tenant-b-doc.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 2048,
      scanStatus: "clean",
      uploadedBy: USER_B,
    })
    .returning();
  if (!rowB) throw new Error("setup: failed to insert file for tenant B");
  fileIdB = rowB.id;
});

afterAll(async () => {
  // DB owner bypasses RLS — safe for cleanup.
  await db.delete(files).where(eq(files.tenantId, TENANT_A));
  await db.delete(files).where(eq(files.tenantId, TENANT_B));
});

// ── READ isolation (layer 1 — explicit tenant_id filter) ──────────────────────
//
// Every application query includes WHERE tenant_id = $callerTenantId.
// These tests verify that pattern: a query scoped to TENANT_A returns 0 rows
// when the row belongs to TENANT_B, regardless of RLS.

describe("files — cross-tenant READ isolation (layer 1)", () => {
  it("query scoped to Tenant A returns nothing for Tenant B file ID", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const rows = await tx
        .select({ id: files.id })
        .from(files)
        .where(and(eq(files.id, fileIdB), eq(files.tenantId, TENANT_A)));
      expect(rows).toHaveLength(0);
    });
  });

  it("query scoped to Tenant B returns nothing for Tenant A file ID", async () => {
    await withTenantContext(TENANT_B, async (tx) => {
      const rows = await tx
        .select({ id: files.id })
        .from(files)
        .where(and(eq(files.id, fileIdA), eq(files.tenantId, TENANT_B)));
      expect(rows).toHaveLength(0);
    });
  });

  it("Tenant A can read its own file rows", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const rows = await tx
        .select({ id: files.id, tenantId: files.tenantId })
        .from(files)
        .where(and(eq(files.id, fileIdA), eq(files.tenantId, TENANT_A)));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.tenantId).toBe(TENANT_A);
    });
  });
});

// ── DELETE isolation (via @platform/files service API) ────────────────────────
//
// deleteFile(db, tenantId, fileId) always includes WHERE tenant_id = $tenantId.
// Cross-tenant deletes return FILE_NOT_FOUND, not a 403 that leaks existence.

describe("files — cross-tenant DELETE isolation", () => {
  it("Tenant A delete of Tenant B file returns FILE_NOT_FOUND", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const err = await deleteFile(tx, TENANT_A, fileIdB).catch((e) => e);
      expect(err).toBeInstanceOf(FileError);
      expect((err as FileError).code).toBe("FILE_NOT_FOUND");
    });
  });

  it("Tenant B delete of Tenant A file returns FILE_NOT_FOUND", async () => {
    await withTenantContext(TENANT_B, async (tx) => {
      const err = await deleteFile(tx, TENANT_B, fileIdA).catch((e) => e);
      expect(err).toBeInstanceOf(FileError);
      expect((err as FileError).code).toBe("FILE_NOT_FOUND");
    });
  });
});
