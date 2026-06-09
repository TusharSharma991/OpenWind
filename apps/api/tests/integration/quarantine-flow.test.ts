/**
 * Quarantine flow integration test — T23.
 *
 * Tests the AV scan lifecycle visible from the @platform/files API surface:
 *   - After confirmUpload, scan_status is "pending" (AV scan queued).
 *   - A file in "quarantined" state cannot be downloaded (FileError).
 *   - A file in "scan_failed" state is also inaccessible.
 *   - The quarantine / scan_failed transitions (performed by the av-scan worker)
 *     are exercised by updating the row directly, simulating what the worker does.
 *
 * The actual worker-side ClamAV TCP logic is unit-tested in
 * apps/worker/src/av-scan.test.ts. This test focuses on the DB lifecycle
 * and the download-gate invariant: only "clean" files may be downloaded.
 *
 * S3 presigned URL generation is mocked. BullMQ is mocked. Redis is mocked.
 * DB operations use the real test database.
 *
 * Requires a live Postgres instance (run with docker compose up -d).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@platform/db";
import { files } from "@platform/db";

// ── Mock S3 ───────────────────────────────────────────────────────────────────

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockResolvedValue("https://s3.example.com/presigned"),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(function () {
    return { send: vi.fn().mockResolvedValue(undefined) };
  }),
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
}));

// ── Mock BullMQ ───────────────────────────────────────────────────────────────

vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(function () {
    return {
      add: vi.fn().mockResolvedValue({ id: "job-av-1" }),
      close: vi.fn().mockResolvedValue(undefined),
    };
  }),
  Worker: vi.fn().mockImplementation(function () {
    return { on: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };
  }),
}));

// ── Mock Redis ────────────────────────────────────────────────────────────────

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

import {
  initiateUpload,
  confirmUpload,
  getDownloadUrl,
  FileError,
} from "@platform/files";

// ── Constants ─────────────────────────────────────────────────────────────────

const TENANT_ID = "cccccccc-3333-4000-c000-000000000001";
const USER_ID = "cccccccc-3333-4000-c000-000000000010";

let fileId: string;

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  const result = await initiateUpload(
    db,
    TENANT_ID,
    USER_ID,
    "helpdesk",
    null,
    "eicar-test.txt",
    "text/plain",
    68,
  );
  fileId = result.fileId;

  // Confirm the upload so the row transitions from pre-upload to pending-scan
  const Redis = (await import("ioredis")).default;
  const redis = new Redis();
  await confirmUpload(db, redis, TENANT_ID, fileId);
});

afterAll(async () => {
  await db.delete(files).where(eq(files.tenantId, TENANT_ID));
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("quarantine lifecycle — download-gate invariant", () => {
  it("T23-1: after confirmUpload, scan_status is pending (AV scan not yet run)", async () => {
    const [row] = await db
      .select({ scanStatus: files.scanStatus })
      .from(files)
      .where(eq(files.id, fileId));

    expect(row?.scanStatus).toBe("pending");
  });

  it("T23-2: pending file cannot be downloaded (download-gate blocks non-clean files)", async () => {
    const err = await getDownloadUrl(db, TENANT_ID, fileId).catch((e) => e);
    expect(err).toBeInstanceOf(FileError);
  });

  it("T23-3: simulated quarantine — worker marks file quarantined → download is blocked", async () => {
    // Simulate what the av-scan worker does when ClamAV returns FOUND
    await db
      .update(files)
      .set({ scanStatus: "quarantined", updatedAt: new Date() })
      .where(eq(files.id, fileId));

    const err = await getDownloadUrl(db, TENANT_ID, fileId).catch((e) => e);
    expect(err).toBeInstanceOf(FileError);
  });

  it("T23-4: simulated scan_failed → download is blocked", async () => {
    await db
      .update(files)
      .set({ scanStatus: "scan_failed", updatedAt: new Date() })
      .where(eq(files.id, fileId));

    const err = await getDownloadUrl(db, TENANT_ID, fileId).catch((e) => e);
    expect(err).toBeInstanceOf(FileError);
  });

  it("T23-5: simulated clean — worker marks file clean → download succeeds", async () => {
    // Simulate what the av-scan worker does when ClamAV returns OK
    await db
      .update(files)
      .set({ scanStatus: "clean", updatedAt: new Date() })
      .where(eq(files.id, fileId));

    const result = await getDownloadUrl(db, TENANT_ID, fileId);
    expect(result.downloadUrl).toBeTruthy();
    expect(result.downloadUrl).toContain("s3.example.com");
  });

  it("T23-6: clean file can be downloaded repeatedly (idempotent)", async () => {
    // File is already clean from T23-5
    const r1 = await getDownloadUrl(db, TENANT_ID, fileId);
    const r2 = await getDownloadUrl(db, TENANT_ID, fileId);
    expect(r1.downloadUrl).toBeTruthy();
    expect(r2.downloadUrl).toBeTruthy();
  });
});
