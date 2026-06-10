/**
 * file-cleanup.test.ts
 *
 * Unit tests for the file cleanup worker.
 * DB and S3 are fully mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────

let capturedProcessor: (() => Promise<void>) | undefined;

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation(function (
    _queue: string,
    processor: () => Promise<void>,
  ) {
    capturedProcessor = processor;
    return {
      on: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
  }),
  Queue: vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

const mockS3Send = vi.fn().mockResolvedValue(undefined);

vi.mock("@aws-sdk/client-s3", () => ({
  // Must use 'function' (not arrow) — vitest 4.x requires a constructable
  // implementation when the mock is used with 'new'.
  S3Client: vi.fn().mockImplementation(function () {
    return {
      send: (...args: unknown[]) => mockS3Send(...args),
    };
  }),
  DeleteObjectCommand: vi.fn(),
}));

const mockDbSelect = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbDelete = vi.fn();

vi.mock("@platform/db", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    delete: (...args: unknown[]) => mockDbDelete(...args),
  },
  files: {
    id: "id",
    tenantId: "tenantId",
    scanStatus: "scanStatus",
    createdAt: "createdAt",
  },
}));

vi.mock("@platform/config", () => ({
  env: {
    S3_ENDPOINT: "http://localhost:9000",
    S3_BUCKET: "test",
    S3_ACCESS_KEY: "key",
    S3_SECRET_KEY: "secret",
    REDIS_URL: "redis://localhost:6379",
  },
}));

vi.mock("@platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("./queues.js", () => ({
  connection: {},
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

function mockSelect(rows: unknown[]) {
  const chain = {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    // The cleanup query now chains .limit(BATCH_LIMIT) after .where(...)
    limit: vi.fn(),
  };
  chain.select.mockReturnValue(chain);
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.limit.mockResolvedValue(rows);
  mockDbSelect.mockReturnValue(chain);
  return chain;
}

function mockDelete() {
  const chain = { where: vi.fn().mockResolvedValue(undefined) };
  mockDbDelete.mockReturnValue(chain);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Note: capturedProcessor is NOT reset here — Worker() fires once at import
  // time. Clearing it would destroy the only reference we have.
});

await import("./file-cleanup.js");

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("file-cleanup worker", () => {
  it("does nothing when no stale files found", async () => {
    mockSelect([]);

    expect(capturedProcessor).toBeDefined();
    await capturedProcessor!();

    expect(mockS3Send).not.toHaveBeenCalled();
    expect(mockDbDelete).not.toHaveBeenCalled();
  });

  it("purges stale files: deletes S3 object, releases quota, deletes row", async () => {
    mockSelect([
      {
        id: "file-1",
        tenantId: "tenant-1",
        storageKey: "tenants/t/files/file-1.pdf",
        sizeBytes: 1024,
      },
    ]);
    mockDelete();

    await capturedProcessor!();

    expect(mockS3Send).toHaveBeenCalledTimes(1);
    expect(mockDbDelete).toHaveBeenCalledTimes(1); // row deletion
  });

  it("continues purging remaining files if one S3 deletion fails", async () => {
    mockSelect([
      {
        id: "file-1",
        tenantId: "tenant-1",
        storageKey: "tenants/t/files/file-1.pdf",
        sizeBytes: 1024,
      },
      {
        id: "file-2",
        tenantId: "tenant-1",
        storageKey: "tenants/t/files/file-2.pdf",
        sizeBytes: 2048,
      },
    ]);
    mockS3Send
      .mockRejectedValueOnce(new Error("S3 error"))
      .mockResolvedValue(undefined);
    mockDelete();

    await capturedProcessor!();

    // Both files should have their rows deleted even though first S3 call failed
    expect(mockDbDelete).toHaveBeenCalledTimes(2);
  });

  it("purges multiple stale files in a single run", async () => {
    const staleFiles = Array.from({ length: 5 }, (_, i) => ({
      id: `file-${i}`,
      tenantId: "tenant-1",
      storageKey: `tenants/t/files/file-${i}.pdf`,
      sizeBytes: 512,
    }));

    mockSelect(staleFiles);
    mockDelete();

    await capturedProcessor!();

    expect(mockS3Send).toHaveBeenCalledTimes(5);
    expect(mockDbDelete).toHaveBeenCalledTimes(5);
  });
});
