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
  },
}));

vi.mock("drizzle-orm", () => ({ eq: vi.fn(), and: vi.fn(), inArray: vi.fn() }));

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

/** Returns an insert mock chain that resolves via onConflictDoNothing().returning() */
function makeInsertChain(rows: unknown[]) {
  return {
    values: vi.fn().mockReturnValue({
      onConflictDoNothing: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

/** Returns an update mock chain that resolves via set().where().returning() */
function makeUpdateChain(rows: unknown[]) {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

/** Returns a select mock chain that resolves via from().where().limit() */
function makeSelectChain(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── provisionTenant ───────────────────────────────────────────────────────────

describe("provisionTenant", () => {
  it("inserts a new active tenant and writes a created audit entry", async () => {
    // M4: single INSERT with onConflictDoNothing — no pre-check SELECT
    mockDbInsert.mockReturnValueOnce(
      makeInsertChain([{ id: TENANT_ID, slug: "acme" }]),
    );

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

  it("throws SLUG_TAKEN when the slug conflicts (onConflictDoNothing returns empty)", async () => {
    // M4: conflict detected via empty RETURNING — no pre-check SELECT
    mockDbInsert.mockReturnValueOnce(makeInsertChain([]));

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
    // G2: atomic conditional UPDATE — returns the updated row
    mockDbUpdate.mockReturnValueOnce(makeUpdateChain([{ id: TENANT_ID }]));

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
    // G2: UPDATE returns empty (wrong state) → SELECT reveals current status
    mockDbUpdate.mockReturnValueOnce(makeUpdateChain([]));
    mockDbSelect.mockReturnValueOnce(
      makeSelectChain([{ status: "suspended" }]),
    );

    await expect(suspendTenant(TENANT_ID, ACTOR_ID)).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });

  it("throws TENANT_NOT_FOUND for unknown tenantId", async () => {
    // G2: UPDATE returns empty → SELECT also empty (tenant doesn't exist)
    mockDbUpdate.mockReturnValueOnce(makeUpdateChain([]));
    mockDbSelect.mockReturnValueOnce(makeSelectChain([]));

    await expect(suspendTenant(TENANT_ID, ACTOR_ID)).rejects.toMatchObject({
      code: "TENANT_NOT_FOUND",
    });
  });
});

// ── reactivateTenant ──────────────────────────────────────────────────────────

describe("reactivateTenant", () => {
  it("transitions suspended tenant to active and invalidates cache", async () => {
    mockDbUpdate.mockReturnValueOnce(makeUpdateChain([{ id: TENANT_ID }]));

    await reactivateTenant(TENANT_ID, ACTOR_ID);

    expect(invalidateTenantStatusCache).toHaveBeenCalledWith(TENANT_ID);
    expect(writeAuditEntry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "transitioned",
        beforeSnapshot: { status: "suspended" },
        afterSnapshot: { status: "active" },
      }),
    );
  });

  it("throws INVALID_TRANSITION when tenant is active", async () => {
    mockDbUpdate.mockReturnValueOnce(makeUpdateChain([]));
    mockDbSelect.mockReturnValueOnce(makeSelectChain([{ status: "active" }]));

    await expect(reactivateTenant(TENANT_ID, ACTOR_ID)).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });
});

// ── scheduleTenantDeletion ────────────────────────────────────────────────────

describe("scheduleTenantDeletion", () => {
  it("sets status to deleted, enqueues purge job, and writes deleted audit entry", async () => {
    // loadTenant SELECT
    mockDbSelect.mockReturnValueOnce(makeSelectChain([{ status: "active" }]));
    // conditional UPDATE succeeds
    mockDbUpdate.mockReturnValueOnce(makeUpdateChain([{ id: TENANT_ID }]));

    const result = await scheduleTenantDeletion(TENANT_ID, ACTOR_ID, 30);

    expect(result.deletionScheduledAt).toBeInstanceOf(Date);
    expect(invalidateTenantStatusCache).toHaveBeenCalledWith(TENANT_ID);
    expect(writeAuditEntry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "deleted" }),
    );
  });

  it("throws INVALID_TRANSITION when tenant is already deleted", async () => {
    // assertTransition throws before the UPDATE
    mockDbSelect.mockReturnValueOnce(makeSelectChain([{ status: "deleted" }]));

    await expect(
      scheduleTenantDeletion(TENANT_ID, ACTOR_ID),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("throws TENANT_NOT_FOUND when tenant does not exist", async () => {
    mockDbSelect.mockReturnValueOnce(makeSelectChain([]));

    await expect(
      scheduleTenantDeletion(TENANT_ID, ACTOR_ID),
    ).rejects.toMatchObject({ code: "TENANT_NOT_FOUND" });
  });
});
