/**
 * Upload flow integration test — T22.
 *
 * Tests the full file lifecycle against a real database and real external
 * services (MinIO for S3, Redis for BullMQ).  No mocks — this is a true
 * integration test.
 *
 *   1. initiateUpload  — creates a file row in "pending" state + presigned upload URL
 *   2. confirmUpload   — enqueues an AV-scan job (scan_status stays "pending")
 *   3. getDownloadUrl  — returns a presigned download URL for a clean file
 *   4. deleteFile      — soft-deletes the row; subsequent calls throw FILE_NOT_FOUND
 *
 * Requires docker compose services: Postgres, MinIO (S3), Redis.
 */

import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@platform/db";
import { files } from "@platform/db";
import Redis from "ioredis";
import {
  initiateUpload,
  confirmUpload,
  getDownloadUrl,
  deleteFile,
  FileError,
} from "@platform/files";

// ── Constants ─────────────────────────────────────────────────────────────────

const TENANT_ID = "cccccccc-1111-4000-c000-000000000001";
const USER_ID = "cccccccc-1111-4000-c000-000000000010";

let createdFileId: string;
let redis: InstanceType<typeof Redis>;

// ── Teardown ──────────────────────────────────────────────────────────────────

afterAll(async () => {
  await db.delete(files).where(eq(files.tenantId, TENANT_ID));
  await redis?.quit();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("file upload flow integration", () => {
  it("T22-1: initiateUpload creates a pending file row and returns a presigned upload URL", async () => {
    const result = await initiateUpload(
      db,
      TENANT_ID,
      USER_ID,
      "helpdesk",
      null,
      "test-document.pdf",
      "application/pdf",
      4096,
    );

    expect(result.fileId).toBeTruthy();
    // Real MinIO returns a presigned URL — just verify it's a URL string
    expect(result.uploadUrl).toMatch(/^https?:\/\//);
    expect(result.uploadUrlExpiresAt).toBeInstanceOf(Date);

    createdFileId = result.fileId;

    const [row] = await db
      .select({ scanStatus: files.scanStatus, tenantId: files.tenantId })
      .from(files)
      .where(eq(files.id, createdFileId));

    expect(row?.scanStatus).toBe("pending");
    expect(row?.tenantId).toBe(TENANT_ID);
  });

  it("T22-2: confirmUpload enqueues an AV-scan job (scan_status stays pending until worker runs)", async () => {
    // Connect to real Redis (running in CI docker compose)
    redis = new Redis({ lazyConnect: true });
    await redis.connect();

    await confirmUpload(db, redis, TENANT_ID, createdFileId);

    const [row] = await db
      .select({ scanStatus: files.scanStatus })
      .from(files)
      .where(eq(files.id, createdFileId));

    // scan_status stays "pending" until the AV worker processes the job
    expect(row?.scanStatus).toBe("pending");
  });

  it("T22-3: getDownloadUrl returns a presigned URL for a clean file", async () => {
    // Manually mark as clean (the AV worker would normally do this)
    await db
      .update(files)
      .set({ scanStatus: "clean" })
      .where(eq(files.id, createdFileId));

    const result = await getDownloadUrl(db, TENANT_ID, createdFileId);

    // Real MinIO returns a presigned URL — verify it's a URL string
    expect(result.downloadUrl).toMatch(/^https?:\/\//);
    expect(result.downloadUrlExpiresAt).toBeInstanceOf(Date);
  });

  it("T22-4: getDownloadUrl rejects quarantined files", async () => {
    await db
      .update(files)
      .set({ scanStatus: "quarantined" })
      .where(eq(files.id, createdFileId));

    await expect(
      getDownloadUrl(db, TENANT_ID, createdFileId),
    ).rejects.toBeInstanceOf(FileError);

    // Reset for next test
    await db
      .update(files)
      .set({ scanStatus: "clean" })
      .where(eq(files.id, createdFileId));
  });

  it("T22-5: deleteFile soft-deletes the file row and subsequent download throws FILE_NOT_FOUND", async () => {
    await deleteFile(db, TENANT_ID, createdFileId);

    // deleteFile is a soft delete — row stays with scan_status = 'deleted'
    const [row] = await db
      .select({ scanStatus: files.scanStatus })
      .from(files)
      .where(eq(files.id, createdFileId));

    expect(row?.scanStatus).toBe("deleted");

    // getDownloadUrl treats 'deleted' as FILE_NOT_FOUND
    await expect(
      getDownloadUrl(db, TENANT_ID, createdFileId),
    ).rejects.toBeInstanceOf(FileError);
  });

  it("T22-6: initiateUpload rejects files exceeding the 100 MB size limit", async () => {
    await expect(
      initiateUpload(
        db,
        TENANT_ID,
        USER_ID,
        "helpdesk",
        null,
        "huge-file.zip",
        "application/zip",
        200 * 1024 * 1024, // 200 MB
      ),
    ).rejects.toBeInstanceOf(FileError);
  });
});
