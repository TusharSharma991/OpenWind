/**
 * Quarantine flow integration test — T23.
 *
 * Tests the AV scan lifecycle visible from the @platform/files API surface,
 * using real external services (MinIO for S3, Redis for BullMQ).  No mocks.
 *
 *   - After confirmUpload, scan_status is "pending" (AV scan queued).
 *   - A file in "quarantined" state cannot be downloaded (FileError).
 *   - A file in "scan_failed" state is also inaccessible.
 *   - The quarantine / scan_failed transitions (performed by the av-scan worker)
 *     are exercised by updating the row directly, simulating what the worker does.
 *
 * The actual worker-side ClamAV TCP logic is unit-tested in
 * apps/worker/src/av-scan.test.ts.  This test focuses on the DB lifecycle
 * and the download-gate invariant: only "clean" files may be downloaded.
 *
 * Requires docker compose services: Postgres, MinIO (S3), Redis.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@platform/db";
import { files } from "@platform/db";
import Redis from "ioredis";
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
let redis: InstanceType<typeof Redis>;

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  // Connect to real Redis (running in CI docker compose)
  redis = new Redis({ lazyConnect: true });
  await redis.connect();

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
  await confirmUpload(db, redis, TENANT_ID, fileId);
});

afterAll(async () => {
  await db.delete(files).where(eq(files.tenantId, TENANT_ID));
  await redis?.quit();
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
    // Real MinIO returns a presigned URL — just verify it's a URL string
    expect(result.downloadUrl).toMatch(/^https?:\/\//);
    expect(result.downloadUrlExpiresAt).toBeInstanceOf(Date);
  });

  it("T23-6: clean file can be downloaded repeatedly (idempotent)", async () => {
    // File is already clean from T23-5
    const r1 = await getDownloadUrl(db, TENANT_ID, fileId);
    const r2 = await getDownloadUrl(db, TENANT_ID, fileId);
    expect(r1.downloadUrl).toMatch(/^https?:\/\//);
    expect(r2.downloadUrl).toMatch(/^https?:\/\//);
  });
});
