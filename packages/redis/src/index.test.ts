import { describe, it, expect, vi, afterEach } from "vitest";

// vi.hoisted ensures these are available inside vi.mock factories (ESM hoisting).
// Implementation uses a regular function (not arrow) — vitest internally calls
// mockImplementation with `new`, and arrow functions cannot be constructors.
const { mockOn, mockQuit, MockRedis } = vi.hoisted(() => {
  const mockOn = vi.fn();
  const mockQuit = vi.fn().mockResolvedValue("OK");
  const MockRedis = vi.fn().mockImplementation(function (this: {
    on: typeof mockOn;
    quit: typeof mockQuit;
    status: string;
  }) {
    this.on = mockOn;
    this.quit = mockQuit;
    this.status = "ready";
  });
  return { mockOn, mockQuit, MockRedis };
});

vi.mock("ioredis", () => ({ default: MockRedis }));
vi.mock("@platform/config", () => ({
  env: { REDIS_URL: "redis://localhost:6379" },
}));
vi.mock("@platform/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}));

// Import AFTER mocks so the module captures the mocked constructor.
const { getRedis, closeRedis } = await import("./index.js");

// ── Tests ─────────────────────────────────────────────────────────────────────

afterEach(async () => {
  // Close first so the quit() call happens before we reset counters.
  // Reversing this order leaks the cleanup quit() into the next test's call counts.
  // Use individual mockClear() — vi.clearAllMocks() would wipe MockRedis.mockImplementation.
  await closeRedis();
  mockOn.mockClear();
  mockQuit.mockClear();
  MockRedis.mockClear();
});

describe("getRedis", () => {
  it("returns the same instance on repeated calls (singleton)", () => {
    const a = getRedis();
    const b = getRedis();
    expect(a).toBe(b);
    expect(MockRedis).toHaveBeenCalledTimes(1);
  });

  it("constructs the client with REDIS_URL from config", () => {
    getRedis();
    expect(MockRedis).toHaveBeenCalledWith("redis://localhost:6379", {
      lazyConnect: false,
    });
  });

  it("registers an error handler on the client", () => {
    getRedis();
    expect(mockOn).toHaveBeenCalledWith("error", expect.any(Function));
  });
});

describe("closeRedis", () => {
  it("calls quit() on the existing client", async () => {
    getRedis();
    await closeRedis();
    expect(mockQuit).toHaveBeenCalledTimes(1);
  });

  it("nulls the singleton so the next getRedis() creates a fresh client", async () => {
    getRedis();
    await closeRedis();
    MockRedis.mockClear(); // clear call count only, not implementation
    getRedis();
    expect(MockRedis).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when no client exists", async () => {
    await closeRedis();
    expect(mockQuit).not.toHaveBeenCalled();
  });
});
