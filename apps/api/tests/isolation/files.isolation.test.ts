/**
 * Tenant isolation tests for the files table.
 *
 * Verifies that cross-tenant data leakage is impossible through:
 *  1. Explicit WHERE tenant_id conditions in all @platform/files queries.
 *  2. Postgres RLS policies enforced via withTenantContext.
 *
 * Requires a live Postgres instance (run with docker compose up -d).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, withTenantContext } from "@platform/db";
import { files } from "@platform/db";

// ── Mock Redis (isolation tests focus on DB/RLS — Redis not relevant) ─────────

vi.mock("ioredis", () => ({
  default: vi.fn().mockImplementation(function () {
    return {
      on: vi.fn(),
      disconnect: vi.fn(),
      lrem: vi.fn().mockResolvedValue(1),
      lrange: vi.fn().mockResolvedValue([]),
    };
  }),
}));

import { FileError, confirmUpload, deleteFile } from "@platform/files";

// ── Test tenant IDs ───────────────────────────────────────────────────────────

const TENANT_A = "aaaaaaaa-1111-4000-a000-000000000001";
const TENANT_B = "bbbbbbbb-1111-4000-b000-000000000002";
const USER_A = "aaaaaaaa-1111-4000-a000-000000000010";
const USER_B = "bbbbbbbb-1111-4000-b000-000000000020";

// ── Shared state ──────────────────────────────────────────────────────────────

let fileIdA: string;
let fileIdB: string;

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Insert file rows directly (bypasses S3 / presigned URL for isolation testing)
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
  // DB owner bypasses RLS — safe to use db directly for cleanup.
  await db.delete(files).where(eq(files.tenantId, TENANT_A));
  await db.delete(files).where(eq(files.tenantId, TENANT_B));
});

// ── READ isolation ────────────────────────────────────────────────────────────

describe("files — cross-tenant READ isolation (RLS)", () => {
  it("Tenant A cannot read Tenant B file rows via withTenantContext", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const rows = await tx
        .select({ id: files.id })
        .from(files)
        .where(eq(files.id, fileIdB));
      // RLS USING policy blocks tenant_id ≠ app.tenant_id
      expect(rows).toHaveLength(0);
    });
  });

  it("Tenant B cannot read Tenant A file rows via withTenantContext", async () => {
    await withTenantContext(TENANT_B, async (tx) => {
      const rows = await tx
        .select({ id: files.id })
        .from(files)
        .where(eq(files.id, fileIdA));
      expect(rows).toHaveLength(0);
    });
  });

  it("Tenant A can read its own file rows", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const rows = await tx
        .select({ id: files.id, tenantId: files.tenantId })
        .from(files)
        .where(eq(files.id, fileIdA));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.tenantId).toBe(TENANT_A);
    });
  });
});

// ── DELETE isolation ──────────────────────────────────────────────────────────

describe("files — cross-tenant DELETE isolation", () => {
  it("Tenant A delete of Tenant B file throws FileError (tenant clause + RLS)", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      await expect(deleteFile(tx, TENANT_A, fileIdB)).rejects.toBeInstanceOf(
        FileError,
      );
    });
  });

  it("deleteFile exposes FILE_NOT_FOUND — not a 403 that leaks existence", async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const err = await deleteFile(tx, TENANT_A, fileIdB).catch((e) => e);
      expect(err).toBeInstanceOf(FileError);
      expect((err as FileError).code).toBe("FILE_NOT_FOUND");
    });
  });
});

// ── confirmUpload isolation ───────────────────────────────────────────────────

describe("files — confirmUpload cross-tenant isolation", () => {
  it("Tenant A cannot confirm Tenant B's pending upload", async () => {
    // Insert a pending file for Tenant B (simulates a file awaiting S3 upload)
    const [pending] = await db
      .insert(files)
      .values({
        tenantId: TENANT_B,
        moduleSlug: "helpdesk",
        entityId: null,
        originalName: "pending-b.pdf",
        storageKey: `${TENANT_B}/helpdesk/pending-b.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 512,
        scanStatus: "pending",
        uploadedBy: USER_B,
      })
      .returning();
    if (!pending) throw new Error("setup: failed to insert pending file");

    const Redis = (await import("ioredis")).default;
    const redis = new Redis();

    try {
      await withTenantContext(TENANT_A, async (tx) => {
        // Tenant A tries to confirm a file that belongs to Tenant B
        await expect(
          confirmUpload(tx, redis, TENANT_A, pending.id),
        ).rejects.toBeInstanceOf(FileError);
      });
    } finally {
      await db.delete(files).where(eq(files.id, pending.id));
    }
  });
});
