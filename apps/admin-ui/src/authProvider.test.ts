import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSigninSilent = vi.fn();
const mockGetUser = vi.fn().mockResolvedValue(null);
const mockAddUserLoaded = vi.fn();
const mockSignoutRedirect = vi.fn();
const mockRemoveUser = vi.fn();
const mockClearStaleState = vi.fn();

vi.mock("oidc-client-ts", () => ({
  UserManager: vi.fn().mockImplementation(function UserManager() {
    return {
      signinSilent: mockSigninSilent,
      getUser: mockGetUser,
      events: { addUserLoaded: mockAddUserLoaded },
      signoutRedirect: mockSignoutRedirect,
      removeUser: mockRemoveUser,
      clearStaleState: mockClearStaleState,
    };
  }),
  WebStorageStateStore: vi.fn(),
}));

vi.mock("@refinedev/core", () => ({}));

const { silentRefresh, authProvider } = await import("./authProvider.js");

describe("silentRefresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the new access_token on success", async () => {
    mockSigninSilent.mockResolvedValue({ access_token: "tok-123" });

    const result = await silentRefresh();

    expect(result).toBe("tok-123");
  });

  it("returns null when signinSilent rejects", async () => {
    mockSigninSilent.mockRejectedValue(new Error("refresh failed"));

    const result = await silentRefresh();

    expect(result).toBeNull();
  });

  it("shares one in-flight signinSilent() call across concurrent callers (single-flight)", async () => {
    let resolveSignin: (v: { access_token: string }) => void;
    mockSigninSilent.mockReturnValue(
      new Promise((resolve) => {
        resolveSignin = resolve;
      }),
    );

    const first = silentRefresh();
    const second = silentRefresh();
    const third = silentRefresh();

    expect(mockSigninSilent).toHaveBeenCalledTimes(1);

    resolveSignin!({ access_token: "shared-tok" });
    const [r1, r2, r3] = await Promise.all([first, second, third]);

    expect(r1).toBe("shared-tok");
    expect(r2).toBe("shared-tok");
    expect(r3).toBe("shared-tok");
  });

  it("starts a fresh signinSilent() call after the previous one has settled", async () => {
    mockSigninSilent.mockResolvedValueOnce({ access_token: "first" });
    const firstResult = await silentRefresh();
    expect(firstResult).toBe("first");

    mockSigninSilent.mockResolvedValueOnce({ access_token: "second" });
    const secondResult = await silentRefresh();
    expect(secondResult).toBe("second");

    expect(mockSigninSilent).toHaveBeenCalledTimes(2);
  });
});

describe("authProvider.logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue(null);
  });

  it("ends the AuthNexus SSO session via signoutRedirect instead of only clearing the local token", async () => {
    mockSignoutRedirect.mockResolvedValue(undefined);

    await authProvider.logout({});

    expect(mockSignoutRedirect).toHaveBeenCalledTimes(1);
    expect(mockRemoveUser).not.toHaveBeenCalled();
  });

  it("passes id_token_hint when a user is present, so AuthNexus can end that exact session", async () => {
    mockGetUser.mockResolvedValue({ id_token: "id-tok-123" });
    mockSignoutRedirect.mockResolvedValue(undefined);

    await authProvider.logout({});

    expect(mockSignoutRedirect).toHaveBeenCalledWith({
      id_token_hint: "id-tok-123",
    });
  });

  it("falls back to local-only cleanup when signoutRedirect fails", async () => {
    mockSignoutRedirect.mockRejectedValue(new Error("network error"));

    const result = await authProvider.logout({});

    expect(mockRemoveUser).toHaveBeenCalledTimes(1);
    expect(mockClearStaleState).toHaveBeenCalled();
    expect(result).toEqual({ success: true, redirectTo: "/login" });
  });
});
