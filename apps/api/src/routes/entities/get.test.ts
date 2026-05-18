import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import type { AuthContext } from "@platform/auth";
import type * as EntityEngine from "@platform/entity-engine";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockGetEntity = vi.fn();

vi.mock("@platform/auth", () => ({
  requireAuth:
    () =>
    async (c: Context<{ Variables: { auth: AuthContext } }>, next: Next) => {
      c.set("auth", {
        tenantId: "t-aaa",
        userId: "u-bbb",
        roles: ["agent"],
        email: "test@example.com",
      });
      await next();
    },
  requireRole: () => async (_c: Context, next: Next) => {
    await next();
  },
}));

vi.mock("@platform/db", () => ({ db: {} }));

vi.mock("@platform/entity-engine", async (importOriginal) => {
  const real = await importOriginal<typeof EntityEngine>();
  return { ...real, getEntity: (...args: unknown[]) => mockGetEntity(...args) };
});

const { getEntityHandler } = await import("./get.js");

// ── Test app ──────────────────────────────────────────────────────────────────

function makeApp() {
  const app = new Hono<{ Variables: { auth: AuthContext } }>();
  app.get("/:id", ...getEntityHandler);
  return app;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const INST_ID = "00000000-0000-0000-0000-000000000002";

const fakeInstance = {
  id: INST_ID,
  entityTypeId: "00000000-0000-0000-0000-000000000001",
  tenantId: "t-aaa",
  workflowId: null,
  currentState: "open",
  fields: { subject: "hello" },
  createdBy: null,
  assignedTo: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /entities/:id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 with the entity instance when found", async () => {
    mockGetEntity.mockResolvedValue(fakeInstance);

    const res = await makeApp().request(`/${INST_ID}`);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.id).toBe(INST_ID);
    expect(mockGetEntity).toHaveBeenCalledWith({}, "t-aaa", INST_ID);
  });

  it("returns 404 when the entity does not exist", async () => {
    const { EntityError } = await import("@platform/entity-engine");
    mockGetEntity.mockRejectedValue(new EntityError("ENTITY_NOT_FOUND"));

    const res = await makeApp().request("/missing-id");

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("ENTITY_NOT_FOUND");
  });

  it("returns 404 for a soft-deleted entity", async () => {
    const { EntityError } = await import("@platform/entity-engine");
    mockGetEntity.mockRejectedValue(new EntityError("ENTITY_NOT_FOUND"));

    const res = await makeApp().request(`/${INST_ID}`);

    expect(res.status).toBe(404);
  });

  it("includes deletedAt as null on active instances", async () => {
    mockGetEntity.mockResolvedValue(fakeInstance);

    const res = await makeApp().request(`/${INST_ID}`);
    const json = await res.json();

    expect(json.data.deletedAt).toBeNull();
  });
});
