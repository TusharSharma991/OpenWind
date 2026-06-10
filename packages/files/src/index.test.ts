/**
 * index.test.ts — @platform/files unit tests
 * S3 SDK, BullMQ, and DB are fully mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Redis } from "ioredis";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPresignedPost = vi.fn();
const mockGetSignedUrl = vi.fn();
const mockS3Send = vi.fn();

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(function () {
    return { send: mockS3Send };
  }),
  DeleteObjectCommand: vi.fn(),
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  createPresignedPost: (...args: unknown[]) => mockPresignedPost(...args),
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
}));

const mockQueueAdd = vi.fn();
const mockQueueClose = vi.fn();
vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(function () {
    return { add: mockQueueAdd, close: mockQueueClose };
  }),
}));

vi.mock("@platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@platform/config", () => ({
  env: {
    S3_ENDPOINT: "http://localhost:9000",
    S3_BUCKET: "test-bucket",
    S3_ACCESS_KEY: "test",
    S3_SECRET_KEY: "test",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("@platform/db", () => ({
  files: {
    id: "files.id",
    tenantId: "files.tenant_id",
    scanStatus: "files.scan_status",
    storageKey: "files.storage_key",
    updatedAt: "files.updated_at",
  },
  tenants: {
    id: "tenants.id",
    config: "tenants.config",
  },
}));

const { initiateUpload, confirmUpload, getDownloadUrl, deleteFile } =
  await import("./index.js");

// ── Helpers ───────────────────────────────────────────────────────────────────

const TENANT_ID = "tenant-aaa";
const USER_ID = "user-bbb";
const FILE_ID = "file-ccc";

function makeRedis(): Redis {
  return {} as Redis;
}

type MockDb = {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

function makeDb(overrides: Partial<MockDb> = {}): MockDb {
  const insertRow = { id: FILE_ID };
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            {
              config: { storage_quota_mb: 100 },
            },
          ]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([insertRow]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQueueAdd.mockResolvedValue({ id: "j-1" });
  mockQueueClose.mockResolvedValue(undefined);
  mockS3Send.mockResolvedValue({});
  mockPresignedPost.mockResolvedValue({
    url: "https://s3.example.com/presigned",
  });
  mockGetSignedUrl.mockResolvedValue("https://s3.example.com/signed-url");
});

// ── initiateUpload ────────────────────────────────────────────────────────────

describe("initiateUpload", () => {
  it("returns fileId + presigned upload URL for a valid request", async () => {
    // DB returns quota=100MB used=0 for quota checks, then file row for insert
    let selectCallCount = 0;
    const db = makeDb({
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() => {
              selectCallCount++;
              if (selectCallCount === 1) {
                // getTenantQuotaBytes
                return Promise.resolve([{ config: { storage_quota_mb: 100 } }]);
              }
              // getTenantUsedBytes
              return Promise.resolve([{ total: "0" }]);
            }),
          }),
        }),
      })),
    });

    const result = await initiateUpload(
      db as never,
      TENANT_ID,
      USER_ID,
      "helpdesk",
      null,
      "report.pdf",
      "application/pdf",
      1024,
    );

    expect(result.fileId).toBe(FILE_ID);
    expect(result.uploadUrl).toBe("https://s3.example.com/signed-url");
    expect(result.uploadUrlExpiresAt).toBeInstanceOf(Date);
  });

  it("throws FILE_TOO_LARGE when sizeBytes exceeds 100MB", async () => {
    const db = makeDb();
    await expect(
      initiateUpload(
        db as never,
        TENANT_ID,
        USER_ID,
        "helpdesk",
        null,
        "huge.zip",
        "application/zip",
        101 * 1024 * 1024, // 101 MB
      ),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });

    expect(db.insert).not.toHaveBeenCalled();
  });

  it("throws QUOTA_EXCEEDED when upload would exceed tenant quota", async () => {
    // getTenantQuotaBytes and getTenantUsedBytes run via Promise.all.
    // Use separate mock chains so each select call returns the right value.
    const limitMock = vi
      .fn()
      .mockResolvedValueOnce([{ config: { storage_quota_mb: 1 } }]) // quota = 1 MB
      .mockResolvedValueOnce([{ total: String(1024 * 1024) }]); // used = 1 MB exactly

    const db = makeDb({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: limitMock,
          }),
        }),
      }),
    });

    await expect(
      initiateUpload(
        db as never,
        TENANT_ID,
        USER_ID,
        "helpdesk",
        null,
        "report.pdf",
        "application/pdf",
        1024, // 1 KB on a fully-used 1 MB quota → exceeds
      ),
    ).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
  });
});

// ── confirmUpload ─────────────────────────────────────────────────────────────

describe("confirmUpload", () => {
  it("enqueues an av-scan job for a pending file", async () => {
    const db = makeDb({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                id: FILE_ID,
                tenantId: TENANT_ID,
                storageKey: "tenant/module/entity/file.pdf",
                scanStatus: "pending",
              },
            ]),
          }),
        }),
      }),
    });

    await confirmUpload(db as never, makeRedis(), TENANT_ID, FILE_ID);

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "scan",
      expect.objectContaining({ fileId: FILE_ID, tenantId: TENANT_ID }),
      expect.objectContaining({ jobId: `av-scan-${FILE_ID}` }),
    );
  });

  it("is idempotent — does not re-enqueue if scan_status is already clean", async () => {
    const db = makeDb({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi
              .fn()
              .mockResolvedValue([
                { id: FILE_ID, scanStatus: "clean", storageKey: "key" },
              ]),
          }),
        }),
      }),
    });

    await confirmUpload(db as never, makeRedis(), TENANT_ID, FILE_ID);
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("throws FILE_NOT_FOUND for unknown fileId", async () => {
    const db = makeDb({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });

    await expect(
      confirmUpload(db as never, makeRedis(), TENANT_ID, FILE_ID),
    ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
  });
});

// ── getDownloadUrl ────────────────────────────────────────────────────────────

describe("getDownloadUrl", () => {
  function makeDbWithStatus(scanStatus: string) {
    return makeDb({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                id: FILE_ID,
                scanStatus,
                storageKey: "key",
                tenantId: TENANT_ID,
              },
            ]),
          }),
        }),
      }),
    });
  }

  it("returns a presigned download URL for a clean file", async () => {
    const db = makeDbWithStatus("clean");
    const result = await getDownloadUrl(db as never, TENANT_ID, FILE_ID);
    expect(result.downloadUrl).toBe("https://s3.example.com/signed-url");
    expect(result.downloadUrlExpiresAt).toBeInstanceOf(Date);
  });

  it("throws FILE_PENDING_SCAN for pending files", async () => {
    const db = makeDbWithStatus("pending");
    await expect(
      getDownloadUrl(db as never, TENANT_ID, FILE_ID),
    ).rejects.toMatchObject({ code: "FILE_PENDING_SCAN" });
  });

  it("throws FILE_PENDING_SCAN for scan_failed files", async () => {
    const db = makeDbWithStatus("scan_failed");
    await expect(
      getDownloadUrl(db as never, TENANT_ID, FILE_ID),
    ).rejects.toMatchObject({ code: "FILE_PENDING_SCAN" });
  });

  it("throws FILE_QUARANTINED for quarantined files", async () => {
    const db = makeDbWithStatus("quarantined");
    await expect(
      getDownloadUrl(db as never, TENANT_ID, FILE_ID),
    ).rejects.toMatchObject({ code: "FILE_QUARANTINED" });
  });

  it("throws FILE_NOT_FOUND for deleted files", async () => {
    const db = makeDbWithStatus("deleted");
    await expect(
      getDownloadUrl(db as never, TENANT_ID, FILE_ID),
    ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
  });
});

// ── deleteFile ────────────────────────────────────────────────────────────────

describe("deleteFile", () => {
  it("marks scan_status as deleted", async () => {
    const db = makeDb({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi
              .fn()
              .mockResolvedValue([
                { id: FILE_ID, scanStatus: "clean", storageKey: "key" },
              ]),
          }),
        }),
      }),
    });

    await deleteFile(db as never, TENANT_ID, FILE_ID);

    expect(db.update).toHaveBeenCalled();
  });

  it("is a no-op for already deleted files", async () => {
    const db = makeDb({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi
              .fn()
              .mockResolvedValue([
                { id: FILE_ID, scanStatus: "deleted", storageKey: "key" },
              ]),
          }),
        }),
      }),
    });

    await deleteFile(db as never, TENANT_ID, FILE_ID);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("throws FILE_NOT_FOUND for unknown fileId", async () => {
    const db = makeDb({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });

    await expect(
      deleteFile(db as never, TENANT_ID, FILE_ID),
    ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
  });
});
