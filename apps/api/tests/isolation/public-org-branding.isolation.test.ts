/**
 * R13 (docs/specs/multi-org-sandbox.md): the unauthenticated login-page brand lookup, against real
 * Postgres. What matters here is what the database can contradict a mock on: only an active
 * sandbox is ever answered, every other kind of tenant gets the same miss as a slug that does not
 * exist, and the answer holds nothing but the name and the logo -- whatever else sits on the row.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import { Hono } from "hono";
import type * as PlatformRedis from "@platform/redis";
import { inArray } from "drizzle-orm";
import { db, tenants } from "@platform/db";

// The limiter keys are recorded and answered here, so the test needs no Redis; the real helper
// still builds the key, so the bucket name it asserts is the production one.
const mockCheckRateLimit = vi.fn();
vi.mock("@platform/redis", async (importOriginal) => {
  const actual = await importOriginal<typeof PlatformRedis>();
  return {
    ...actual,
    getRedis: () => ({}),
    checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  };
});

const { getOrgBrandingBySlugHandler } =
  await import("../../src/routes/public/org-branding.js");

const STAMP = Date.now();
const ACTIVE = {
  id: "eeeeeeee-0157-4000-e000-000000000157",
  slug: `r13-active-${STAMP}`,
};
const REAL = {
  id: "ffffffff-0157-4000-f000-000000000157",
  slug: `r13-real-${STAMP}`,
};
const SUSPENDED = {
  id: "dddddddd-0157-4000-d000-000000000157",
  slug: `r13-suspended-${STAMP}`,
};
const DELETED = {
  id: "cccccccc-0157-4000-c000-000000000157",
  slug: `r13-deleted-${STAMP}`,
};
const PURGED = {
  id: "bbbbbbbb-0157-4000-b000-000000000157",
  slug: `r13-purged-${STAMP}`,
};
const ALL_IDS = [ACTIVE.id, REAL.id, SUSPENDED.id, DELETED.id, PURGED.id];
const LOGO = "data:image/png;base64,iVBORw0KGgo=";

function makeApp(): Hono {
  const app = new Hono();
  app.get("/org-branding/:slug", ...getOrgBrandingBySlugHandler);
  return app;
}

async function lookup(slug: string): Promise<Response> {
  return makeApp().request(`/org-branding/${slug}`);
}

beforeAll(async () => {
  await db
    .insert(tenants)
    .values([
      {
        id: ACTIVE.id,
        name: "R13 Active Sandbox",
        slug: ACTIVE.slug,
        isSandbox: true,
        logo: LOGO,
        plan: "premium-marker",
        config: { secret_marker: "must-not-leak" },
        zitadelOrgId: `org-r13-${STAMP}`,
      },
      {
        id: REAL.id,
        name: "R13 Real Customer",
        slug: REAL.slug,
        isSandbox: false,
        logo: LOGO,
      },
      {
        id: SUSPENDED.id,
        name: "R13 Suspended Sandbox",
        slug: SUSPENDED.slug,
        isSandbox: true,
        status: "suspended",
        logo: LOGO,
      },
      {
        id: DELETED.id,
        name: "R13 Deleted Sandbox",
        slug: DELETED.slug,
        isSandbox: true,
        status: "deleted",
        logo: LOGO,
      },
      {
        id: PURGED.id,
        name: "R13 Purged Sandbox",
        slug: PURGED.slug,
        isSandbox: true,
        status: "purged",
      },
    ])
    .onConflictDoNothing();
});

beforeEach(() => {
  mockCheckRateLimit.mockReset();
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 29,
    resetAt: 0,
  });
});

afterAll(async () => {
  await db.delete(tenants).where(inArray(tenants.id, ALL_IDS));
});

describe("GET /public/org-branding/:slug (public-org-branding, R13)", () => {
  it("answers an active sandbox with exactly its name and logo", async () => {
    const res = await lookup(ACTIVE.slug);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(Object.keys(body)).toEqual(["data"]);
    expect(Object.keys(body.data).sort()).toEqual(["logo", "name"]);
    expect(body.data).toEqual({ name: "R13 Active Sandbox", logo: LOGO });
  });

  it("never leaks another column of the row, whatever it holds", async () => {
    const text = await (await lookup(ACTIVE.slug)).text();

    for (const secret of [
      ACTIVE.id,
      "premium-marker",
      "must-not-leak",
      `org-r13-${STAMP}`,
      "isSandbox",
      "is_sandbox",
      "status",
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it.each([
    ["a real (non-sandbox) tenant", REAL.slug],
    ["a suspended sandbox", SUSPENDED.slug],
    ["a deleted sandbox", DELETED.slug],
    ["a purged sandbox", PURGED.slug],
    ["a slug that does not exist", `r13-nobody-${STAMP}`],
    ["a malformed slug", "Not_A_Slug!"],
  ])("answers %s with the one shared miss, uncached", async (_label, slug) => {
    const res = await lookup(slug);

    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      error: "NOT_FOUND",
      message: "Not found",
    });
  });

  it("gives every miss a byte-identical body, so no case can be told from another", async () => {
    const bodies = await Promise.all(
      [
        REAL.slug,
        SUSPENDED.slug,
        DELETED.slug,
        PURGED.slug,
        `r13-nobody-${STAMP}`,
        "Not_A_Slug!",
      ].map(async (slug) => (await lookup(slug)).text()),
    );

    expect(new Set(bodies).size).toBe(1);
  });

  it("does not match a slug by prefix or by case", async () => {
    expect((await lookup(ACTIVE.slug.slice(0, -2))).status).toBe(404);
    expect((await lookup(ACTIVE.slug.toUpperCase())).status).toBe(404);
  });

  it("limits by address in a bucket of its own, never the /auth class sign-in shares", async () => {
    await lookup(ACTIVE.slug);

    const key = mockCheckRateLimit.mock.calls[0]?.[1] as string;
    expect(key.startsWith("rl:public-branding:")).toBe(true);
    expect(key).not.toMatch(/:auth$/);
  });

  it("answers 429 and reads nothing once the limit is spent", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: 1,
    });

    const res = await lookup(ACTIVE.slug);

    expect(res.status).toBe(429);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).not.toContain("R13 Active Sandbox");
  });
});
