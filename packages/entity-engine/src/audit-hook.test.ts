/**
 * audit-hook.test.ts
 *
 * Unit tests for the entity engine audit hook mechanism.
 * Verifies registration, firing, no-op when unregistered, and error propagation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  registerEntityAuditHook,
  isEntityAuditHookRegistered,
  fireEntityAuditHook,
  _resetEntityAuditHook,
} from "./audit-hook.js";
import type { EntityAuditHookParams } from "./audit-hook.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeParams(
  overrides: Partial<EntityAuditHookParams> = {},
): EntityAuditHookParams {
  return {
    db: {} as EntityAuditHookParams["db"],
    tenantId: "tenant-1",
    actorId: "user-1",
    actorType: "user",
    resourceType: "ticket",
    resourceId: "resource-uuid-1",
    action: "created",
    beforeSnapshot: null,
    afterSnapshot: { subject: "Hello" },
    entityFields: [{ name: "subject", sensitivity: "public" }],
    ...overrides,
  };
}

beforeEach(() => {
  // Reset hook state between tests so they are independent.
  _resetEntityAuditHook();
});

// ── Registration ──────────────────────────────────────────────────────────────

describe("registerEntityAuditHook", () => {
  it("isEntityAuditHookRegistered returns false before registration", () => {
    expect(isEntityAuditHookRegistered()).toBe(false);
  });

  it("isEntityAuditHookRegistered returns true after registration", () => {
    registerEntityAuditHook(vi.fn());
    expect(isEntityAuditHookRegistered()).toBe(true);
  });

  it("subsequent registration replaces the previous hook", async () => {
    const first = vi.fn().mockResolvedValue(undefined);
    const second = vi.fn().mockResolvedValue(undefined);

    registerEntityAuditHook(first);
    registerEntityAuditHook(second);

    await fireEntityAuditHook(makeParams());

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});

// ── Firing ────────────────────────────────────────────────────────────────────

describe("fireEntityAuditHook", () => {
  it("is a no-op when no hook is registered", async () => {
    // Should not throw — just resolves silently.
    await expect(fireEntityAuditHook(makeParams())).resolves.toBeUndefined();
  });

  it("calls the registered hook with the exact params passed", async () => {
    const hook = vi.fn().mockResolvedValue(undefined);
    registerEntityAuditHook(hook);

    const params = makeParams({
      action: "updated",
      beforeSnapshot: { subject: "Old" },
      afterSnapshot: { subject: "New" },
      entityFields: [
        { name: "subject", sensitivity: "public" },
        { name: "ssn", sensitivity: "pii" },
      ],
    });

    await fireEntityAuditHook(params);

    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith(params);
  });

  it("forwards hook errors to the caller", async () => {
    const hookError = new Error("audit write failed");
    registerEntityAuditHook(vi.fn().mockRejectedValue(hookError));

    await expect(fireEntityAuditHook(makeParams())).rejects.toThrow(
      "audit write failed",
    );
  });

  it("passes actorType correctly for all action types", async () => {
    const hook = vi.fn().mockResolvedValue(undefined);
    registerEntityAuditHook(hook);

    const actions = ["created", "updated", "deleted"] as const;
    for (const action of actions) {
      hook.mockClear();
      await fireEntityAuditHook(makeParams({ action, actorType: "api_key" }));
      expect(hook).toHaveBeenCalledWith(
        expect.objectContaining({ action, actorType: "api_key" }),
      );
    }
  });

  it("passes beforeSnapshot as null for created actions", async () => {
    const hook = vi.fn().mockResolvedValue(undefined);
    registerEntityAuditHook(hook);

    await fireEntityAuditHook(
      makeParams({ action: "created", beforeSnapshot: null }),
    );

    expect(hook).toHaveBeenCalledWith(
      expect.objectContaining({ beforeSnapshot: null, action: "created" }),
    );
  });

  it("passes afterSnapshot as null for deleted actions", async () => {
    const hook = vi.fn().mockResolvedValue(undefined);
    registerEntityAuditHook(hook);

    await fireEntityAuditHook(
      makeParams({
        action: "deleted",
        beforeSnapshot: { subject: "Bye" },
        afterSnapshot: null,
      }),
    );

    expect(hook).toHaveBeenCalledWith(
      expect.objectContaining({ afterSnapshot: null, action: "deleted" }),
    );
  });
});
