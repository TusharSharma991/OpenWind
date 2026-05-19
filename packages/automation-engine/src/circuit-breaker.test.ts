import { describe, it, expect, vi, beforeEach } from "vitest";
import { isOpen, recordFailure, reset } from "./circuit-breaker.js";

const redisMock = {
  get: vi.fn(),
  incr: vi.fn(),
  expire: vi.fn(),
  del: vi.fn(),
};

describe("circuit breaker", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("isOpen", () => {
    it("returns false when key is absent", async () => {
      redisMock.get.mockResolvedValue(null);
      const result = await isOpen(redisMock as never, "t-aaa", "notify");
      expect(result).toBe(false);
    });

    it("returns false when failure count is below threshold", async () => {
      redisMock.get.mockResolvedValue("3");
      const result = await isOpen(redisMock as never, "t-aaa", "notify", 5);
      expect(result).toBe(false);
    });

    it("returns true when failure count meets threshold", async () => {
      redisMock.get.mockResolvedValue("5");
      const result = await isOpen(redisMock as never, "t-aaa", "notify", 5);
      expect(result).toBe(true);
    });

    it("returns true when failure count exceeds threshold", async () => {
      redisMock.get.mockResolvedValue("9");
      const result = await isOpen(redisMock as never, "t-aaa", "notify");
      expect(result).toBe(true);
    });
  });

  describe("recordFailure", () => {
    it("increments the failure counter", async () => {
      redisMock.incr.mockResolvedValue(1);
      redisMock.expire.mockResolvedValue(1);

      await recordFailure(redisMock as never, "t-aaa", "webhook");

      expect(redisMock.incr).toHaveBeenCalledWith("circuit:t-aaa:webhook");
    });

    it("sets TTL on the first failure", async () => {
      redisMock.incr.mockResolvedValue(1);
      redisMock.expire.mockResolvedValue(1);

      await recordFailure(redisMock as never, "t-aaa", "webhook", 600);

      expect(redisMock.expire).toHaveBeenCalledWith(
        "circuit:t-aaa:webhook",
        600,
      );
    });

    it("does not set TTL on subsequent failures", async () => {
      redisMock.incr.mockResolvedValue(3);

      await recordFailure(redisMock as never, "t-aaa", "webhook");

      expect(redisMock.expire).not.toHaveBeenCalled();
    });
  });

  describe("reset", () => {
    it("deletes the circuit key", async () => {
      redisMock.del.mockResolvedValue(1);

      await reset(redisMock as never, "t-aaa", "notify");

      expect(redisMock.del).toHaveBeenCalledWith("circuit:t-aaa:notify");
    });
  });
});
