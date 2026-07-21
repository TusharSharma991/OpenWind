import { describe, it, expect, vi } from "vitest";

vi.mock("@platform/config", () => ({
  env: {
    AUTHNEXUS_ISSUER: "https://auth.rokkalabs.com",
  },
}));

const mockLoggerWarn = vi.fn();
vi.mock("@platform/logger", () => ({
  logger: { info: vi.fn(), warn: mockLoggerWarn, error: vi.fn() },
}));

const { listOrgUsers } = await import("./authnexus-management.js");

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
