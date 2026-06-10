/**
 * tenant-lifecycle.test.ts — unit tests for the tenant lifecycle service.
 * DB, BullMQ, and audit are fully mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(function () {
    return { add: vi.fn().mockResolvedValue({ id: "job-1" }) };
  }),
}));

vi.mock("@platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@platform/audit", () => ({
  writeAuditEntry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@platform/auth", () => ({
  invalidateTenantStatusCache: vi.fn(),
}));

const mockDbUpdate = vi.fn();
const mockDbInsert = vi.fn();
const mockDbSelect = vi.fn();

vi.mock("@platform/db", () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
  },
  tenants: {
    id: "tenants.id",
    slug: "tenants.slug",
    status: "tenants.status",
    name: "tenants.name",
    slug_col: "tenants.slug",
  },
}));

vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));

vi.mock("./redis.js", () => ({
  connection: {},
}));

// Import AFTER mocks are set up
const {
  provisionTenant,
  suspendTenant,
  reactivateTenant,
  scheduleTenantDeletion,
} = await import("./tenant-lifecycle.js");

const { writeAuditEntry } = await import("@platform/audit");
const { invalidateTenantStatusCache } = await import("@platform/auth");

// ── Helpers ───────────────────────────────────────────────────────────────────

const TENANT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const ACTOR_ID = "user-superadmin-1";

beforeEach(() => {
  vi.clearAllMocks();
});

// ── provisionTenant ───────────────────────────────────────────────────────────

describe("provisionTenant", () => {
  it("inserts a new active tenant and writes a created audit entry", async () => {
    // No existing slug
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    // Insert returning
    mockDbInsert.mockReturnValueOnce({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: TENANT_ID, slug: "acme" }]),
      }),
    });

    const result = await provisionTenant(
      { name: "Acme Corp", slug: "acme", plan: "standard" },
      ACTOR_ID,
    );

    expect(result).toEqual({ id: TENANT_ID, slug: "acme" });
    expect(writeAuditEntry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "created", tenantId: TENANT_ID }),
    );
  });

  it("throws SLUG_TAKEN when the slug is already in use", async () => {
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: "existing-id" }]),
        }),
      }),
    });

    await expect(
      provisionTenant(
        { name: "Acme", slug: "acme", plan: "standard" },
        ACTOR_ID,
      ),
    ).rejects.toMatchObject({ code: "SLUG_TAKEN" });
  });
});

// ── suspendTenant ─────────────────────────────────────────────────────────────

describe("suspendTenant", () => {
  it("transitions active tenant to suspended and invalidates cache", async () => {
    // loadTenant
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ status: "active" }]),
        }),
      }),
    });
    mockDbUpdate.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });

    await suspendTenant(TENANT_ID, ACTOR_ID);

    expect(invalidateTenantStatusCache).toHaveBeenCalledWith(TENANT_ID);
    expect(writeAuditEntry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "transitioned",
        beforeSnapshot: { status: "active" },
        afterSnapshot: { status: "suspended" },
      }),
    );
  });

  it("throws INVALID_TRANSITION when tenant is already suspended", async () => {
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ status: "suspended" }]),
        }),
      }),
    });

    await expect(suspendTenant(TENANT_ID, ACTOR_ID)).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });

  it("throws TENANT_NOT_FOUND for unknown tenantId", async () => {
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    await expect(suspendTenant(TENANT_ID, ACTOR_ID)).rejects.toMatchObject({
      code: "TENANT_NOT_FOUND",
    });
  });
});

// ── reactivateTenant ──────────────────────────────────────────────────────────

describe("reactivateTenant", () => {
  it("transitions suspended tenant to active and invalidates cache", async () => {
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ status: "suspended" }]),
        }),
      }),
    });
    mockDbUpdate.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });

    await reactivateTenant(TENANT_ID, ACTOR_ID);

    expect(invalidateTenantStatusCache).toHaveBeenCalledWith(TENANT_ID);
    expect(writeAuditEntry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "transitioned",
        afterSnapshot: { status: "active" },
      }),
    );
  });

  it("throws INVALID_TRANSITION when tenant is active", async () => {
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ status: "active" }]),
        }),
      }),
    });

    await expect(reactivateTenant(TENANT_ID, ACTOR_ID)).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });
});

// ── scheduleTenantDeletion ────────────────────────────────────────────────────

describe("scheduleTenantDeletion", () => {
  it("sets status to deleted, enqueues purge job, and writes deleted audit entry", async () => {
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ status: "active" }]),
        }),
      }),
    });
    mockDbUpdate.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });

    const result = await scheduleTenantDeletion(TENANT_ID, ACTOR_ID, 30);

    expect(result.deletionScheduledAt).toBeInstanceOf(Date);
    expect(invalidateTenantStatusCache).toHaveBeenCalledWith(TENANT_ID);
    expect(writeAuditEntry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "deleted" }),
    );
  });

  it("throws INVALID_TRANSITION when tenant is already deleted", async () => {
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ status: "deleted" }]),
        }),
      }),
    });

    await expect(
      scheduleTenantDeletion(TENANT_ID, ACTOR_ID),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});
