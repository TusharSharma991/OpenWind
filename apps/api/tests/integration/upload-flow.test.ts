/**
 * Upload flow integration test — T22.
 *
 * Tests the full file lifecycle against a real database:
 *   1. initiateUpload  — creates a file row in "pending" state + presigned upload URL
 *   2. confirmUpload   — marks the row as completed (scan_status remains pending until AV)
 *   3. getDownloadUrl  — returns a presigned download URL for a clean file
 *   4. deleteFile      — removes the row; subsequent calls throw FILE_NOT_FOUND
 *
 * S3 and Redis are mocked. BullMQ queue is mocked.
 * DB operations use the real test database.
 *
 * Requires a live Postgres instance (run with docker compose up -d).
 */

import { describe, it, expect, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@platform/db";
import { files } from "@platform/db";

// ── Mock S3 (presigned URL generation) ───────────────────────────────────────

const MOCK_UPLOAD_URL = "https://s3.example.com/presigned-upload";
const MOCK_DOWNLOAD_URL = "https://s3.example.com/presigned-download";

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi
    .fn()
    .mockResolvedValueOnce(MOCK_UPLOAD_URL)
    .mockResolvedValue(MOCK_DOWNLOAD_URL),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(function () {
    return { send: vi.fn().mockResolvedValue(undefined) };
  }),
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
}));

// ── Mock Redis (used by confirmUpload to dequeue the scan job) ────────────────

const mockRedis = {
  lrem: vi.fn().mockResolvedValue(1),
  lrange: vi.fn().mockResolvedValue([]),
};

vi.mock("ioredis", () => ({
  default: vi.fn().mockImplementation(function () {
    return { ...mockRedis, on: vi.fn(), disconnect: vi.fn() };
  }),
}));

// ── Mock BullMQ (prevent Redis connection) ────────────────────────────────────

vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(function () {
    return {
      add: vi.fn().mockResolvedValue({ id: "job-1" }),
      close: vi.fn().mockResolvedValue(undefined),
    };
  }),
  Worker: vi.fn().mockImplementation(function () {
    return { on: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };
  }),
}));

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

// ── Teardown ──────────────────────────────────────────────────────────────────

afterAll(async () => {
  await db.delete(files).where(eq(files.tenantId, TENANT_ID));
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
    expect(result.uploadUrl).toBe(MOCK_UPLOAD_URL);

    createdFileId = result.fileId;

    const [row] = await db
      .select({ scanStatus: files.scanStatus, tenantId: files.tenantId })
      .from(files)
      .where(eq(files.id, createdFileId));

    expect(row?.scanStatus).toBe("pending");
    expect(row?.tenantId).toBe(TENANT_ID);
  });

  it("T22-2: confirmUpload marks the file as still pending (awaiting AV scan)", async () => {
    // confirmUpload requires a Redis client for queue coordination
    const Redis = (await import("ioredis")).default;
    const redis = new Redis();

    await confirmUpload(db, redis, TENANT_ID, createdFileId);

    const [row] = await db
      .select({ scanStatus: files.scanStatus })
      .from(files)
      .where(eq(files.id, createdFileId));

    // scan_status stays "pending" until the AV worker processes the job
    expect(row?.scanStatus).toBe("pending");
  });

  it("T22-3: getDownloadUrl returns a presigned URL for a clean file", async () => {
    // Manually mark as clean (AV worker would normally do this)
    await db
      .update(files)
      .set({ scanStatus: "clean" })
      .where(eq(files.id, createdFileId));

    const result = await getDownloadUrl(db, TENANT_ID, createdFileId);

    expect(result.downloadUrl).toBe(MOCK_DOWNLOAD_URL);
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

  it("T22-5: deleteFile removes the file row and subsequent download throws FILE_NOT_FOUND", async () => {
    await deleteFile(db, TENANT_ID, createdFileId);

    const rows = await db
      .select({ id: files.id })
      .from(files)
      .where(eq(files.id, createdFileId));

    expect(rows).toHaveLength(0);

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
