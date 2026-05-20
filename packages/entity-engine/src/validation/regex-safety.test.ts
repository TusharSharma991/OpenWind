import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock recheck and logger before importing the module under test ─────────────

const mockCheck = vi.fn();

vi.mock("recheck", () => ({
  check: (...args: unknown[]) => mockCheck(...args),
}));

vi.mock("@platform/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const { isSafeRegex } = await import("./regex-safety.js");

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("isSafeRegex", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns true when recheck reports safe", async () => {
    mockCheck.mockResolvedValue({ status: "safe" });
    expect(await isSafeRegex("^[a-z]+$")).toBe(true);
  });

  it("returns true when recheck reports unknown", async () => {
    mockCheck.mockResolvedValue({ status: "unknown" });
    expect(await isSafeRegex("^[a-z]+$")).toBe(true);
  });

  it("returns false when recheck reports vulnerable", async () => {
    mockCheck.mockResolvedValue({ status: "vulnerable", complexity: {} });
    expect(await isSafeRegex("(a+)+$")).toBe(false);
  });

  it("returns false when recheck reports timeout — fail-closed", async () => {
    // A pattern complex enough to time out the static analyser is the
    // highest-risk category and must be rejected, not silently accepted.
    mockCheck.mockResolvedValue({ status: "timeout" });
    expect(await isSafeRegex("(.*){10}$")).toBe(false);
  });

  it("returns false when the pattern is syntactically invalid", async () => {
    // Invalid regex — recheck should not even be called
    expect(await isSafeRegex("[unclosed")).toBe(false);
    expect(mockCheck).not.toHaveBeenCalled();
  });

  it("returns false (fail-safe) when recheck throws unexpectedly", async () => {
    mockCheck.mockRejectedValue(new Error("unexpected internal error"));
    expect(await isSafeRegex("^[a-z]+$")).toBe(false);
  });

  it("forwards flags to recheck", async () => {
    mockCheck.mockResolvedValue({ status: "safe" });
    await isSafeRegex("^hello$", "i");
    expect(mockCheck).toHaveBeenCalledWith("^hello$", "i");
  });
});
