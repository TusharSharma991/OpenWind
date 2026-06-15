import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import type { AuthContext } from "@platform/auth";
import type * as EntityEngine from "@platform/entity-engine";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockDeleteEntity = vi.fn();

vi.mock("@platform/auth", () => ({
  requireAuth:
    () =>
    async (c: Context<{ Variables: { auth: AuthContext } }>, next: Next) => {
      c.set("auth", {
        tenantId: "t-aaa",
        userId: "u-bbb",
        roles: ["admin"],
        email: "test@example.com",
      });
      await next();
    },
  requireRole: () => async (_c: Context, next: Next) => {
    await next();
  },
  requireIntrospection: () => async (_c: Context, next: Next) => {
    await next();
  },
}));

vi.mock("@platform/db", () => ({
  db: {},
  withTenantContext: (tenantId, fn) => fn({}),
}));

vi.mock("@platform/entity-engine", async (importOriginal) => {
  const real = await importOriginal<typeof EntityEngine>();
  return {
    ...real,
    deleteEntity: (...args: unknown[]) => mockDeleteEntity(...args),
  };
});

const { deleteEntityHandler } = await import("./delete.js");

// ── Test app ──────────────────────────────────────────────────────────────────

function makeApp() {
  const app = new Hono<{ Variables: { auth: AuthContext } }>();
  app.delete("/:id", ...deleteEntityHandler);
  return app;
}

const INST_ID = "00000000-0000-0000-0000-000000000002";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DELETE /entities/:id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 204 with no body on successful soft-delete", async () => {
    mockDeleteEntity.mockResolvedValue(undefined);

    const res = await makeApp().request(`/${INST_ID}`, { method: "DELETE" });

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(mockDeleteEntity).toHaveBeenCalledWith(
      {},
      "t-aaa",
      INST_ID,
      "u-bbb",
    );
  });

  it("returns 404 when the entity does not exist", async () => {
    const { EntityError } = await import("@platform/entity-engine");
    mockDeleteEntity.mockRejectedValue(new EntityError("ENTITY_NOT_FOUND"));

    const res = await makeApp().request(`/${INST_ID}`, { method: "DELETE" });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("ENTITY_NOT_FOUND");
  });

  it("returns 404 when attempting to delete an already-deleted entity", async () => {
    const { EntityError } = await import("@platform/entity-engine");
    // The engine applies isNull(deletedAt), so already-deleted rows are treated as not found
    mockDeleteEntity.mockRejectedValue(new EntityError("ENTITY_NOT_FOUND"));

    const res = await makeApp().request(`/${INST_ID}`, { method: "DELETE" });

    expect(res.status).toBe(404);
  });
});
