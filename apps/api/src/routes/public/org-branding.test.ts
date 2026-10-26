import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type * as DrizzleOrm from "drizzle-orm";

const mockRows = vi.fn();
const mockWhere = vi.fn((_condition: unknown) => ({ limit: () => mockRows() }));
const mockSelect = vi.fn((_columns: unknown) => ({
  from: () => ({ where: mockWhere }),
}));
vi.mock("@platform/db", () => ({
  db: { select: (columns: unknown) => mockSelect(columns) },
  tenants: {
    slug: "slug",
    isSandbox: "isSandbox",
    status: "status",
    name: "name",
    logo: "logo",
  },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof DrizzleOrm>();
  return {
    ...actual,
    eq: (a: unknown, b: unknown) => ["eq", a, b],
    and: (...args: unknown[]) => ["and", ...args],
  };
});

const mockEnforce = vi.fn();
vi.mock("../../lib/rate-limit-tiers.js", () => ({
  enforcePublicBrandingRateLimit: (...args: unknown[]) => mockEnforce(...args),
}));

vi.mock("../../middleware/rate-limit.js", () => ({
  rateLimitKey: () => "203.0.113.7",
}));

const { getOrgBrandingBySlugHandler } = await import("./org-branding.js");

function get(slug: string): Promise<Response> {
  const app = new Hono();
  app.get("/org-branding/:slug", ...getOrgBrandingBySlugHandler);
  return Promise.resolve(app.request(`/org-branding/${slug}`));
}

const MISS_BODY = { error: "NOT_FOUND", message: "Not found" };

beforeEach(() => {
  vi.clearAllMocks();
  mockEnforce.mockResolvedValue({ allowed: true, remaining: 29, resetAt: 0 });
});

describe("GET /public/org-branding/:slug", () => {
  it("returns exactly name and logo for an active sandbox, cacheable for a minute", async () => {
    mockRows.mockResolvedValue([
      { name: "Acme Demo", logo: "data:image/png;base64,AAAA" },
    ]);

    const res = await get("acme-demo-4821");

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(await res.json()).toEqual({
      data: { name: "Acme Demo", logo: "data:image/png;base64,AAAA" },
    });
  });

  it("selects only the name and logo columns, so nothing else can reach the response", async () => {
    mockRows.mockResolvedValue([{ name: "Acme Demo", logo: null }]);

    await get("acme-demo-4821");

    expect(mockSelect).toHaveBeenCalledWith({ name: "name", logo: "logo" });
  });

  it("only ever matches an active sandbox, never a real tenant", async () => {
    mockRows.mockResolvedValue([]);

    await get("acme-demo-4821");

    expect(mockWhere).toHaveBeenCalledWith([
      "and",
      ["eq", "slug", "acme-demo-4821"],
      ["eq", "isSandbox", true],
      ["eq", "status", "active"],
    ]);
  });

  it("answers an unknown slug with the shared 404, never cached", async () => {
    mockRows.mockResolvedValue([]);

    const res = await get("nobody-1234");

    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual(MISS_BODY);
  });

  it.each([
    ["uppercase", "Acme-Demo-4821"],
    ["an underscore", "acme_demo"],
    ["a leading dash", "-acme"],
    ["a trailing dash", "acme-"],
    ["a doubled dash", "acme--demo"],
    ["a dot", "acme.demo"],
    ["encoded markup", "%3Cscript%3E"],
    ["a quote", "acme'demo"],
    ["more than 80 characters", "a".repeat(81)],
  ])(
    "refuses %s with the same 404 and never reads the database",
    async (_label, slug) => {
      const res = await get(slug);

      expect(res.status).toBe(404);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(await res.json()).toEqual(MISS_BODY);
      expect(mockSelect).not.toHaveBeenCalled();
    },
  );

  it("gives a malformed slug the byte-identical body of an unknown one", async () => {
    mockRows.mockResolvedValue([]);

    const unknown = await (await get("nobody-1234")).text();
    const malformed = await (await get("Not_A_Slug")).text();

    expect(malformed).toBe(unknown);
  });

  it("accepts a slug of exactly 80 characters", async () => {
    mockRows.mockResolvedValue([]);

    await get("a".repeat(80));

    expect(mockSelect).toHaveBeenCalled();
  });

  it("answers 429 uncached and reads nothing when the limit is spent", async () => {
    mockEnforce.mockResolvedValue({ allowed: false, remaining: 0, resetAt: 1 });

    const res = await get("acme-demo-4821");

    expect(res.status).toBe(429);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("limits by the client address, before it looks at the slug", async () => {
    await get("Not_A_Slug");

    expect(mockEnforce).toHaveBeenCalledWith("203.0.113.7");
  });

  it("needs no sign-in", async () => {
    mockRows.mockResolvedValue([{ name: "Acme Demo", logo: null }]);

    const res = await get("acme-demo-4821");

    expect(res.status).toBe(200);
  });
});
