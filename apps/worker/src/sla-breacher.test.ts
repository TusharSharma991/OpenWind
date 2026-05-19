import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("./queues.js", () => ({
  connection: {},
  slaQueue: { add: vi.fn() },
}));

vi.mock("@platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockSelectLimit = vi.fn();
const mockSelectWhere = vi.fn(() => ({ limit: mockSelectLimit }));
const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

const mockInsertValues = vi.fn().mockResolvedValue([]);
const mockInsert = vi.fn(() => ({ values: mockInsertValues }));

const dbMock = { select: mockSelect, insert: mockInsert };

vi.mock("@platform/db", () => ({
  db: dbMock,
  outboxEvents: "outbox_events_mock",
  entityInstances: "entity_instances_mock",
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col, val) => ({ col, val, op: "eq" })),
  and: vi.fn((...args) => ({ args, op: "and" })),
}));

// BullMQ Worker is mocked so we capture and invoke the processor directly
let capturedProcessor: ((job: unknown) => Promise<void>) | null = null;

vi.mock("bullmq", () => ({
  Worker: vi
    .fn()
    .mockImplementation(
      (_queue: string, processor: (job: unknown) => Promise<void>) => {
        capturedProcessor = processor;
        return { on: vi.fn(), close: vi.fn() };
      },
    ),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_JOB = {
  id: "job-1",
  data: {
    outboxEventId: "outbox-aaa",
    tenantId: "tenant-111",
    instanceId: "instance-222",
    workflowId: "workflow-333",
    stateName: "in_review",
    slaHours: 24,
    fireAt: new Date().toISOString(),
  },
};

// ── Import after mocks ────────────────────────────────────────────────────────

await import("./sla-breacher.js");

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("slaBreacher processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectLimit.mockResolvedValue([]);
  });

  it("writes workflow.sla_breached outbox event when instance is still in expected state", async () => {
    mockSelectLimit.mockResolvedValueOnce([{ currentState: "in_review" }]);

    await capturedProcessor!(BASE_JOB);

    expect(mockInsert).toHaveBeenCalledOnce();
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "workflow.sla_breached",
        tenantId: "tenant-111",
      }),
    );
  });

  it("skips without writing when instance has already transitioned", async () => {
    mockSelectLimit.mockResolvedValueOnce([{ currentState: "resolved" }]);

    await capturedProcessor!(BASE_JOB);

    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("skips without writing when instance is not found", async () => {
    mockSelectLimit.mockResolvedValueOnce([]);

    await capturedProcessor!(BASE_JOB);

    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("includes stateName and slaHours in the outbox payload", async () => {
    mockSelectLimit.mockResolvedValueOnce([{ currentState: "in_review" }]);

    await capturedProcessor!(BASE_JOB);

    const payload = mockInsertValues.mock.calls[0]?.[0];
    expect(payload?.payload).toMatchObject({
      stateName: "in_review",
      slaHours: 24,
      workflowId: "workflow-333",
    });
  });
});
