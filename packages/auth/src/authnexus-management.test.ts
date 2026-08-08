import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@platform/config", () => ({
  env: {
    AUTHNEXUS_ISSUER: "https://auth.rokkalabs.com",
    AUTHNEXUS_PROJECT_ID: "project-xyz",
  },
}));

const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();
vi.mock("@platform/logger", () => ({
  logger: { info: vi.fn(), warn: mockLoggerWarn, error: mockLoggerError },
}));

const {
  listOrgUsers,
  listProjectRoles,
  getSubordinateIds,
  invalidateUserCache,
} = await import("./authnexus-management.js");

describe("listOrgUsers", () => {
  it("fails closed and returns [] when orgId is undefined — never falls through to an unfiltered instance-wide query", async () => {
    // @ts-expect-error — intentionally passing undefined to exercise the runtime guard
    const result = await listOrgUsers(undefined, "token");

    expect(result).toEqual([]);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      {},
      expect.stringContaining("without an orgId"),
    );
  });

  it("fails closed and returns [] when orgId is an empty string", async () => {
    const result = await listOrgUsers("", "token");

    expect(result).toEqual([]);
  });
});

describe("listProjectRoles", () => {
  it("returns [] when orgId is an empty string", async () => {
    const result = await listProjectRoles("", "token");

    expect(result).toEqual([]);
  });
});

describe("getSubordinateIds", () => {
  const fetchMock = vi.fn();

  function connectionsResponse(overrides: Record<string, unknown> = {}) {
    return {
      dataIncomplete: false,
      user: { userId: "mgr-1" },
      descendants: {
        directReportsCount: 0,
        totalReportsCount: 0,
        reports: [],
      },
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    mockLoggerWarn.mockClear();
    mockLoggerError.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    invalidateUserCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns [] and hasReports:false when orgId or userId is empty", async () => {
    const result = await getSubordinateIds("", "u1", "token");

    expect(result).toEqual({
      ids: [],
      hasReports: false,
      status: "unavailable",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("flattens a nested reports tree of any depth into a flat userId list", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve(
          connectionsResponse({
            descendants: {
              directReportsCount: 2,
              totalReportsCount: 4,
              reports: [
                {
                  userId: "u2",
                  children: [{ userId: "u4", children: [{ userId: "u5" }] }],
                },
                { userId: "u3" },
              ],
            },
          }),
        ),
    });

    const result = await getSubordinateIds("org-1", "mgr-1", "token");

    expect(result.status).toBe("ok");
    expect(result.hasReports).toBe(true);
    expect(new Set(result.ids)).toEqual(new Set(["u2", "u3", "u4", "u5"]));
  });

  it("uses ?detail=ids and forwards the caller's own bearer token", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(connectionsResponse()),
    });

    await getSubordinateIds("org-1", "mgr-1", "the-users-own-token");

    const [url, options] = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toContain(
      "/api/admin/orgs/org-1/users/mgr-1/connections?detail=ids",
    );
    expect(options.headers.Authorization).toBe("Bearer the-users-own-token");
  });

  it("returns hasReports:false when directReportsCount is 0", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(connectionsResponse()),
    });

    const result = await getSubordinateIds("org-1", "u1", "token");

    expect(result).toEqual({ ids: [], hasReports: false, status: "ok" });
  });

  it("degrades to unavailable immediately on a non-200 response, no retry", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    const result = await getSubordinateIds("org-1", "u1", "token");

    expect(result).toEqual({
      ids: [],
      hasReports: false,
      status: "unavailable",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("degrades to unavailable on a network error, without throwing", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    const result = await getSubordinateIds("org-1", "u1", "token");

    expect(result).toEqual({
      ids: [],
      hasReports: false,
      status: "unavailable",
    });
    expect(mockLoggerError).toHaveBeenCalled();
  });

  it("returns unavailable on dataIncomplete, and keeps retrying (not permanently) within the budget", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve(
          connectionsResponse({ dataIncomplete: true, user: null }),
        ),
    });

    const first = await getSubordinateIds("org-1", "u1", "token");
    expect(first.status).toBe("unavailable");

    // 10 minutes later — still within the ~20min budget, still incomplete upstream.
    vi.advanceTimersByTime(10 * 60 * 1000);
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(connectionsResponse()),
    });
    const second = await getSubordinateIds("org-1", "u1", "token");

    // Resolves successfully once AuthNexus actually has the data — confirms
    // the tracker doesn't permanently lock out a key before the budget expires.
    expect(second.status).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("permanently falls back to unavailable once dataIncomplete persists past the ~20min budget, without calling AuthNexus again", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve(
          connectionsResponse({ dataIncomplete: true, user: null }),
        ),
    });

    await getSubordinateIds("org-1", "u1", "token");
    vi.advanceTimersByTime(21 * 60 * 1000);
    const result = await getSubordinateIds("org-1", "u1", "token");
    expect(result.status).toBe("unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // A third call must not hit AuthNexus at all — permanently unavailable.
    const third = await getSubordinateIds("org-1", "u1", "token");
    expect(third.status).toBe("unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("logs (but does not throw or surface) wasCycleMember:true", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve(
          connectionsResponse({ user: { userId: "u1", wasCycleMember: true } }),
        ),
    });

    const result = await getSubordinateIds("org-1", "u1", "token");

    expect(result.status).toBe("ok");
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", userId: "u1" }),
      expect.stringContaining("cycle member"),
    );
  });

  it("caches a successful result and does not re-fetch within the TTL", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(connectionsResponse()),
    });

    await getSubordinateIds("org-1", "u1", "token");
    await getSubordinateIds("org-1", "u1", "token");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after the cache TTL expires", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(connectionsResponse()),
    });

    await getSubordinateIds("org-1", "u1", "token");
    vi.advanceTimersByTime(6 * 60 * 1000);
    await getSubordinateIds("org-1", "u1", "token");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
