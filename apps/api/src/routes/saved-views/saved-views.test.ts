import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import type { AuthContext } from "@platform/auth";
import type * as DrizzleOrm from "drizzle-orm";

// ── Drizzle mock helpers ───────────────────────────────────────────────────────

/**
 * makeTx — returns a mock Drizzle transaction that records calls and resolves
 * to the value set via `__resolve`. Supports the chains used by saved-views routes:
 *   tx.select().from().where().orderBy()
 *   tx.select({ value: count() }).from().where()
 *   tx.insert().values().returning()
 *   tx.update().set().where().returning()
 *   tx.delete().where().returning({ id })
 */
function makeTx(resolve: unknown = []) {
  const chain: Record<string, () => unknown> = {};
  const terminal = () => Promise.resolve(resolve);
  // Each method returns the same chain (fluent), except terminal ones return a promise
  ["from", "where", "orderBy"].forEach((m) => {
    chain[m] = () => chain;
  });
  (chain as unknown as { then: unknown }).then =
    terminal().then.bind(terminal());
  Object.defineProperty(chain, Symbol.toStringTag, { value: "MockChain" });

  // Make the chain itself thenable (awaitable)
  const thenable = {
    ...chain,
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      terminal().then(res, rej),
  };

  const builder = {
    select: () => thenable,
    insert: () => ({
      values: () => ({ returning: terminal }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({ returning: terminal }),
      }),
    }),
    delete: () => ({
      where: () => ({ returning: terminal }),
    }),
    execute: terminal,
  };

  return builder;
}

// ── Module mocks ──────────────────────────────────────────────────────────────

let mockTxResolve: unknown = [];
let mockWithTenantAndUserContext: ReturnType<typeof vi.fn>;

vi.mock("@platform/db", () => {
  const savedViews = { id: "sv.id", tenantId: "sv.tenant_id" }; // shape hint only
  return {
    savedViews,
    withTenantAndUserContext: (...args: unknown[]) =>
      mockWithTenantAndUserContext(...args),
  };
});

vi.mock("@platform/auth", () => ({
  requireAuth:
    () =>
    async (c: Context<{ Variables: { auth: AuthContext } }>, next: Next) => {
      c.set("auth", {
        tenantId: "tenant-aaa",
        userId: "user-bbb",
        roles: ["agent"],
        email: "test@example.com",
      });
      await next();
    },
  requireRole:
    (..._roles: string[]) =>
    async (_c: Context, next: Next) => {
      await next();
    },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const real = await importOriginal<typeof DrizzleOrm>();
  return {
    ...real,
    eq: vi.fn((_col, _val) => "mock-eq"),
    and: vi.fn((..._args) => "mock-and"),
    count: vi.fn(() => ({ as: () => "mock-count" })),
  };
});

// ── Test setup ─────────────────────────────────────────────────────────────────

const { listSavedViewsHandler } = await import("./list.js");
const { createSavedViewHandler } = await import("./create.js");
const { updateSavedViewHandler } = await import("./update.js");
const { deleteSavedViewHandler } = await import("./delete.js");

function makeApp() {
  const app = new Hono<{ Variables: { auth: AuthContext } }>();
  app.get("/", ...listSavedViewsHandler);
  app.post("/", ...createSavedViewHandler);
  app.patch("/:id", ...updateSavedViewHandler);
  app.delete("/:id", ...deleteSavedViewHandler);
  return app;
}

const VIEW_ID = "00000000-0000-0000-0000-000000000001";
const ENTITY_TYPE_ID = "00000000-0000-0000-0000-000000000010";

const fakeView = {
  id: VIEW_ID,
  tenantId: "tenant-aaa",
  userId: "user-bbb",
  entityTypeId: ENTITY_TYPE_ID,
  name: "My Open Tickets",
  filterConfig: { state: "open" },
  sortConfig: {},
  isDefault: false,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockWithTenantAndUserContext = vi.fn(
    (
      _tenantId: string,
      _userId: string,
      fn: (tx: unknown) => Promise<unknown>,
    ) => {
      const tx = makeTx(mockTxResolve);
      return fn(tx);
    },
  );
});

// ── GET / ──────────────────────────────────────────────────────────────────────

describe("GET /saved-views", () => {
  it("returns list of views for the authenticated user", async () => {
    mockTxResolve = [fakeView];
    const app = makeApp();
    const res = await app.request(`/?entityTypeId=${ENTITY_TYPE_ID}`, {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(1);
    expect((body.data[0] as typeof fakeView).id).toBe(VIEW_ID);
  });

  it("returns 400 when entityTypeId is missing", async () => {
    mockTxResolve = [];
    const app = makeApp();
    const res = await app.request("/");
    expect(res.status).toBe(400);
  });

  it("passes tenantId and userId to withTenantAndUserContext", async () => {
    mockTxResolve = [];
    const app = makeApp();
    await app.request(`/?entityTypeId=${ENTITY_TYPE_ID}`);
    expect(mockWithTenantAndUserContext).toHaveBeenCalledWith(
      "tenant-aaa",
      "user-bbb",
      expect.any(Function),
    );
  });
});

// ── POST / ────────────────────────────────────────────────────────────────────

describe("POST /saved-views", () => {
  it("creates a view and returns 201", async () => {
    // First call = count (returns [{value:0}]), second call = insert (returns [fakeView])
    let callCount = 0;
    mockWithTenantAndUserContext = vi.fn(
      (_t: string, _u: string, fn: (tx: unknown) => Promise<unknown>) => {
        callCount++;
        const selectResult = callCount === 1 ? [{ value: 0 }] : [fakeView];
        const tx = {
          select: () => ({
            from: () => ({
              where: () => Promise.resolve(selectResult),
            }),
          }),
          insert: () => ({
            values: () => ({
              returning: () => Promise.resolve([fakeView]),
            }),
          }),
          update: () => ({
            set: () => ({
              where: () => ({ returning: () => Promise.resolve([]) }),
            }),
          }),
        };
        return fn(tx);
      },
    );

    const app = makeApp();
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entityTypeId: ENTITY_TYPE_ID,
        name: "My Open Tickets",
        filterConfig: { state: "open" },
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: typeof fakeView };
    expect(body.data.name).toBe("My Open Tickets");
  });

  it("returns 409 when 20 views already exist", async () => {
    mockWithTenantAndUserContext = vi.fn(
      (_t: string, _u: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          select: () => ({
            from: () => ({
              where: () => Promise.resolve([{ value: 20 }]),
            }),
          }),
        };
        return fn(tx);
      },
    );

    const app = makeApp();
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityTypeId: ENTITY_TYPE_ID, name: "view 21" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("SAVED_VIEW_LIMIT_REACHED");
  });

  it("stores userId from auth context, not from request body", async () => {
    let capturedInsertValues: Record<string, unknown> | null = null;
    mockWithTenantAndUserContext = vi.fn(
      (_t: string, _u: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          select: () => ({
            from: () => ({
              where: () => Promise.resolve([{ value: 0 }]),
            }),
          }),
          insert: () => ({
            values: (vals: Record<string, unknown>) => {
              capturedInsertValues = vals;
              return {
                returning: () => Promise.resolve([{ ...fakeView, ...vals }]),
              };
            },
          }),
          update: () => ({
            set: () => ({
              where: () => ({ returning: () => Promise.resolve([]) }),
            }),
          }),
        };
        return fn(tx);
      },
    );

    const app = makeApp();
    await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entityTypeId: ENTITY_TYPE_ID,
        name: "injected",
        userId: "attacker-id", // should be ignored
      }),
    });

    // userId must come from auth context (user-bbb), not the body
    expect(capturedInsertValues?.userId).toBe("user-bbb");
    expect(capturedInsertValues?.userId).not.toBe("attacker-id");
  });

  it("clears prior default when isDefault=true", async () => {
    const updateSpy = vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([])) })),
      })),
    }));

    mockWithTenantAndUserContext = vi.fn(
      (_t: string, _u: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          select: () => ({
            from: () => ({
              where: () => Promise.resolve([{ value: 1 }]),
            }),
          }),
          insert: () => ({
            values: () => ({
              returning: () =>
                Promise.resolve([{ ...fakeView, isDefault: true }]),
            }),
          }),
          update: updateSpy,
        };
        return fn(tx);
      },
    );

    const app = makeApp();
    await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entityTypeId: ENTITY_TYPE_ID,
        name: "default view",
        isDefault: true,
      }),
    });

    expect(updateSpy).toHaveBeenCalled();
  });
});

// ── PATCH /:id ────────────────────────────────────────────────────────────────

describe("PATCH /saved-views/:id", () => {
  it("updates the view and returns 200", async () => {
    const updated = { ...fakeView, name: "Renamed" };
    mockWithTenantAndUserContext = vi.fn(
      (_t: string, _u: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          update: () => ({
            set: () => ({
              where: () => ({ returning: () => Promise.resolve([updated]) }),
            }),
          }),
        };
        return fn(tx);
      },
    );

    const app = makeApp();
    const res = await app.request(`/${VIEW_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Renamed" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: typeof fakeView };
    expect(body.data.name).toBe("Renamed");
  });

  it("returns 404 when view not found (RLS filters it out)", async () => {
    mockWithTenantAndUserContext = vi.fn(
      (_t: string, _u: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          update: () => ({
            set: () => ({
              where: () => ({ returning: () => Promise.resolve([]) }),
            }),
          }),
        };
        return fn(tx);
      },
    );

    const app = makeApp();
    const res = await app.request(`/${VIEW_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Ghost" }),
    });
    expect(res.status).toBe(404);
  });
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────

describe("DELETE /saved-views/:id", () => {
  it("deletes and returns 204", async () => {
    mockWithTenantAndUserContext = vi.fn(
      (_t: string, _u: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          delete: () => ({
            where: () => ({
              returning: () => Promise.resolve([{ id: VIEW_ID }]),
            }),
          }),
        };
        return fn(tx);
      },
    );

    const app = makeApp();
    const res = await app.request(`/${VIEW_ID}`, { method: "DELETE" });
    expect(res.status).toBe(204);
  });

  it("returns 404 when view not found", async () => {
    mockWithTenantAndUserContext = vi.fn(
      (_t: string, _u: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          delete: () => ({
            where: () => ({ returning: () => Promise.resolve([]) }),
          }),
        };
        return fn(tx);
      },
    );

    const app = makeApp();
    const res = await app.request(`/${VIEW_ID}`, { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});
