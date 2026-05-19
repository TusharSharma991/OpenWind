import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockSlaQueueAdd = vi.fn().mockResolvedValue({ id: "job-1" });

vi.mock("./queues.js", () => ({
  slaQueue: { add: mockSlaQueueAdd },
  connection: {},
}));

vi.mock("@platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockTxExecute = vi.fn();
const mockTxUpdate = vi.fn(() => ({
  set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
}));
const mockTransaction = vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
  await fn({ execute: mockTxExecute, update: mockTxUpdate });
});

vi.mock("@platform/db", () => ({
  db: { transaction: mockTransaction },
  outboxEvents: "outbox_events_mock",
}));

vi.mock("drizzle-orm", () => ({
  sql: vi.fn((..._args: unknown[]) => ({ op: "sql" })),
  inArray: vi.fn((col, vals) => ({ col, vals, op: "inArray" })),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRow(
  overrides: Partial<{
    id: string;
    tenant_id: string;
    fireAt: string;
  }> = {},
) {
  const fireAt =
    overrides.fireAt ?? new Date(Date.now() + 3_600_000).toISOString();
  return {
    id: overrides.id ?? "outbox-aaa",
    tenant_id: overrides.tenant_id ?? "tenant-111",
    payload: {
      instanceId: "instance-222",
      workflowId: "workflow-333",
      stateName: "in_review",
      slaHours: 24,
      fireAt,
    },
  };
}

// ── Import after mocks ────────────────────────────────────────────────────────

const { tick } = await import("./sla-scheduler.js");

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SLA scheduler tick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enqueues a delayed BullMQ job with jobId=sla:{outboxEventId}", async () => {
    const row = makeRow({ id: "outbox-abc" });
    mockTxExecute.mockResolvedValueOnce([row]);

    await tick();

    expect(mockSlaQueueAdd).toHaveBeenCalledWith(
      "sla.breach",
      expect.objectContaining({
        outboxEventId: "outbox-abc",
        instanceId: "instance-222",
        stateName: "in_review",
      }),
      expect.objectContaining({ jobId: "sla:outbox-abc" }),
    );
  });

  it("computes delay from fireAt — future fireAt results in positive delay", async () => {
    const fireAt = new Date(Date.now() + 7_200_000).toISOString(); // 2 h from now
    mockTxExecute.mockResolvedValueOnce([makeRow({ fireAt })]);

    await tick();

    const opts = mockSlaQueueAdd.mock.calls[0]?.[2] as { delay?: number };
    expect(opts.delay).toBeGreaterThan(0);
  });

  it("uses delay=0 when fireAt is in the past", async () => {
    const fireAt = new Date(Date.now() - 5_000).toISOString(); // 5 s ago
    mockTxExecute.mockResolvedValueOnce([makeRow({ fireAt })]);

    await tick();

    const opts = mockSlaQueueAdd.mock.calls[0]?.[2] as { delay?: number };
    expect(opts.delay).toBe(0);
  });

  it("marks outbox events as delivered after enqueueing", async () => {
    mockTxExecute.mockResolvedValueOnce([makeRow()]);

    await tick();

    expect(mockTxUpdate).toHaveBeenCalledOnce();
  });

  it("does nothing when there are no undelivered SLA outbox events", async () => {
    mockTxExecute.mockResolvedValueOnce([]);

    await tick();

    expect(mockSlaQueueAdd).not.toHaveBeenCalled();
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  it("logs and swallows errors so the poller keeps running", async () => {
    mockTransaction.mockRejectedValueOnce(new Error("DB unavailable"));
    const { logger } = await import("@platform/logger");

    await tick();

    expect(logger.error).toHaveBeenCalled();
  });
});
