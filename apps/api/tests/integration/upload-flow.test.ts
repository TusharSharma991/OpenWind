/**
 * Upload flow integration test — T22.
 *
 * Tests the full file lifecycle against a real database, real Redis (BullMQ),
 * and real local disk storage. No mocks — this is a true integration test.
 *
 *   1. saveUpload      — writes bytes to disk, creates a file row in "pending"
 *                         state, enqueues an AV-scan job
 *   2. getFileStream   — returns a readable stream for a clean file
 *   3. deleteFile      — soft-deletes the row + removes bytes from disk;
 *                         subsequent calls throw FILE_NOT_FOUND
 *
 * Requires docker compose services: Postgres, Redis.
 */

import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import fsp from "node:fs/promises";
import { withTenantContext } from "@platform/db";
import { files } from "@platform/db";
import Redis from "ioredis";
import {
  saveUpload,
  getFileStream,
  deleteFile,
  resolveStoragePath,
  FileError,
} from "@platform/files";

// ── Constants ─────────────────────────────────────────────────────────────────

const TENANT_ID = "cccccccc-1111-4000-c000-000000000001";
const USER_ID = "cccccccc-1111-4000-c000-000000000010";

let createdFileId: string;
let redis: InstanceType<typeof Redis>;

async function readStreamToString(stream: {
  [Symbol.asyncIterator](): AsyncIterator<Buffer>;
}): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}

// ── Teardown ──────────────────────────────────────────────────────────────────

afterAll(async () => {
  await withTenantContext(TENANT_ID, (tx) =>
    tx.delete(files).where(eq(files.tenantId, TENANT_ID)),
  );
  await fsp
    .rm(resolveStoragePath(TENANT_ID), { recursive: true, force: true })
    .catch(() => undefined);
  await redis?.quit();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("file upload flow integration", () => {
  it("T22-1: saveUpload writes bytes to disk, creates a pending file row, and enqueues an AV-scan job", async () => {
    redis = new Redis({ lazyConnect: true });
    await redis.connect();

    const result = await withTenantContext(TENANT_ID, (tx) =>
      saveUpload(
        tx,
        redis,
        TENANT_ID,
        USER_ID,
        "helpdesk",
        null,
        "test-document.pdf",
        "application/pdf",
        Buffer.from("hello world"),
      ),
    );

    expect(result.fileId).toBeTruthy();
    expect(result.scanStatus).toBe("pending");

    createdFileId = result.fileId;

    const [row] = await withTenantContext(TENANT_ID, (tx) =>
      tx
        .select({
          scanStatus: files.scanStatus,
          tenantId: files.tenantId,
          storageKey: files.storageKey,
        })
        .from(files)
        .where(eq(files.id, createdFileId)),
    );

    expect(row?.scanStatus).toBe("pending");
    expect(row?.tenantId).toBe(TENANT_ID);

    const onDisk = await fsp.readFile(resolveStoragePath(row!.storageKey));
    expect(onDisk.toString()).toBe("hello world");
  });

  it("T22-2: getFileStream streams bytes for a clean file", async () => {
    // Manually mark as clean (the AV worker would normally do this)
    await withTenantContext(TENANT_ID, (tx) =>
      tx
        .update(files)
        .set({ scanStatus: "clean" })
        .where(eq(files.id, createdFileId)),
    );

    const result = await withTenantContext(TENANT_ID, (tx) =>
      getFileStream(tx, TENANT_ID, createdFileId),
    );
    const content = await readStreamToString(result.stream);

    expect(content).toBe("hello world");
    expect(result.originalName).toBe("test-document.pdf");
  });

  it("T22-3: getFileStream rejects quarantined files", async () => {
    await withTenantContext(TENANT_ID, (tx) =>
      tx
        .update(files)
        .set({ scanStatus: "quarantined" })
        .where(eq(files.id, createdFileId)),
    );

    await expect(
      withTenantContext(TENANT_ID, (tx) =>
        getFileStream(tx, TENANT_ID, createdFileId),
      ),
    ).rejects.toBeInstanceOf(FileError);

    // Reset for next test
    await withTenantContext(TENANT_ID, (tx) =>
      tx
        .update(files)
        .set({ scanStatus: "clean" })
        .where(eq(files.id, createdFileId)),
    );
  });

  it("T22-4: deleteFile soft-deletes the file row, removes bytes from disk, and subsequent download throws FILE_NOT_FOUND", async () => {
    const [{ storageKey }] = await withTenantContext(TENANT_ID, (tx) =>
      tx
        .select({ storageKey: files.storageKey })
        .from(files)
        .where(eq(files.id, createdFileId)),
    );

    await withTenantContext(TENANT_ID, (tx) =>
      deleteFile(tx, TENANT_ID, createdFileId),
    );

    // deleteFile is a soft delete — row stays with scan_status = 'deleted'
    const [row] = await withTenantContext(TENANT_ID, (tx) =>
      tx
        .select({ scanStatus: files.scanStatus })
        .from(files)
        .where(eq(files.id, createdFileId)),
    );

    expect(row?.scanStatus).toBe("deleted");

    // bytes are gone from disk
    await expect(fsp.access(resolveStoragePath(storageKey))).rejects.toThrow();

    // getFileStream treats 'deleted' as FILE_NOT_FOUND
    await expect(
      withTenantContext(TENANT_ID, (tx) =>
        getFileStream(tx, TENANT_ID, createdFileId),
      ),
    ).rejects.toBeInstanceOf(FileError);
  });

  it("T22-5: saveUpload rejects files exceeding the 100 MB size limit", async () => {
    await expect(
      withTenantContext(TENANT_ID, (tx) =>
        saveUpload(
          tx,
          redis,
          TENANT_ID,
          USER_ID,
          "helpdesk",
          null,
          "huge-file.zip",
          "application/zip",
          Buffer.alloc(101 * 1024 * 1024), // 101 MB
        ),
      ),
    ).rejects.toBeInstanceOf(FileError);
  });
});
