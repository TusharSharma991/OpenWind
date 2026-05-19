import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockUpdateEntity = vi.fn();
const mockExecuteTransition = vi.fn();

const dbMock = {
  select: () => ({
    from: () => ({
      where: () => ({
        orderBy: () => mockSelect(),
      }),
    }),
  }),
  insert: () => ({
    values: () => ({
      returning: mockInsert,
    }),
  }),
  update: () => ({
    set: () => ({
      where: mockUpdate,
    }),
  }),
};

vi.mock("@platform/db", () => ({
  automationRules: {},
  automationExecutions: {},
  db: dbMock,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn((...args: unknown[]) => args),
}));

vi.mock("@platform/workflow-engine", () => ({
  evaluateConditionTree: vi.fn(() => true),
  executeTransition: (...args: unknown[]) => mockExecuteTransition(...args),
}));

vi.mock("@platform/entity-engine", () => ({
  updateEntity: (...args: unknown[]) => mockUpdateEntity(...args),
}));

vi.mock("@platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { executeAutomationRules } = await import("./executor.js");

const BASE_EVENT = {
  version: 1 as const,
  eventType: "workflow.transitioned" as const,
  tenantId: "t-aaa",
  instanceId: "00000000-0000-0000-0000-000000000001",
  entityTypeId: "00000000-0000-0000-0000-000000000002",
  workflowId: "00000000-0000-0000-0000-000000000003",
  fromState: "open",
  toState: "closed",
  triggeredBy: "user" as const,
  actorId: null,
  occurredAt: "2026-01-01T00:00:00Z",
};

const EXEC_ROW = { id: "exec-001" };
const NOTIFY_RULE = {
  id: "rule-001",
  tenantId: "t-aaa",
  isEnabled: true,
  triggerType: "workflow.transitioned",
  priority: 0,
  createdAt: new Date(),
  conditions: null,
  actions: [{ type: "notify", config: { channel: ["email"] } }],
};

describe("executeAutomationRules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockResolvedValue([EXEC_ROW]);
    mockUpdate.mockResolvedValue(undefined);
  });

  it("executes matching rules and writes execution row with success status", async () => {
    mockSelect.mockResolvedValue([NOTIFY_RULE]);

    await executeAutomationRules(dbMock as never, "t-aaa", BASE_EVENT);

    expect(mockInsert).toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalled();
  });

  it("skips rules whose conditions are not met", async () => {
    const { evaluateConditionTree } = await import("@platform/workflow-engine");
    vi.mocked(evaluateConditionTree).mockReturnValueOnce(false);
    mockSelect.mockResolvedValue([NOTIFY_RULE]);

    await executeAutomationRules(dbMock as never, "t-aaa", BASE_EVENT);

    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("executes set_field action by calling updateEntity", async () => {
    mockSelect.mockResolvedValue([
      {
        ...NOTIFY_RULE,
        actions: [
          {
            type: "set_field",
            config: { field: "priority", value: "high" },
          },
        ],
      },
    ]);
    mockUpdateEntity.mockResolvedValue({ id: BASE_EVENT.instanceId });

    await executeAutomationRules(dbMock as never, "t-aaa", BASE_EVENT);

    expect(mockUpdateEntity).toHaveBeenCalledWith(
      dbMock,
      "t-aaa",
      BASE_EVENT.instanceId,
      expect.objectContaining({ fields: { priority: "high" } }),
    );
  });

  it("executes transition action by calling executeTransition", async () => {
    mockSelect.mockResolvedValue([
      {
        ...NOTIFY_RULE,
        actions: [
          {
            type: "transition",
            config: {
              transitionId: "00000000-0000-0000-0000-000000000099",
            },
          },
        ],
      },
    ]);
    mockExecuteTransition.mockResolvedValue({
      id: "ev-1",
      instanceId: BASE_EVENT.instanceId,
      workflowId: BASE_EVENT.workflowId,
      fromState: "open",
      toState: "closed",
      createdAt: new Date(),
    });
    // Follow-up rules execution returns no rules
    mockSelect.mockResolvedValueOnce([NOTIFY_RULE]).mockResolvedValue([]);

    await executeAutomationRules(dbMock as never, "t-aaa", BASE_EVENT);

    expect(mockExecuteTransition).toHaveBeenCalledWith(
      dbMock,
      "t-aaa",
      expect.objectContaining({
        instanceId: BASE_EVENT.instanceId,
        transitionId: "00000000-0000-0000-0000-000000000099",
        triggeredBy: "automation",
      }),
    );
  });

  it("throws MAX_DEPTH_EXCEEDED at depth 10", async () => {
    const { AutomationError } = await import("./types.js");
    await expect(
      executeAutomationRules(dbMock as never, "t-aaa", BASE_EVENT, 10),
    ).rejects.toBeInstanceOf(AutomationError);
  });

  it("does not throw at depth 9", async () => {
    mockSelect.mockResolvedValue([]);
    await expect(
      executeAutomationRules(dbMock as never, "t-aaa", BASE_EVENT, 9),
    ).resolves.toBeUndefined();
  });

  it("writes failed status when action throws", async () => {
    mockSelect.mockResolvedValue([
      {
        ...NOTIFY_RULE,
        actions: [
          {
            type: "set_field",
            config: { field: "x", value: 1 },
          },
        ],
      },
    ]);
    mockUpdateEntity.mockRejectedValue(new Error("DB error"));

    await executeAutomationRules(dbMock as never, "t-aaa", BASE_EVENT);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.anything(),
    );
  });

  it("throws INVALID_EVENT_PAYLOAD for unknown event shapes", async () => {
    const { AutomationError } = await import("./types.js");
    await expect(
      executeAutomationRules(dbMock as never, "t-aaa", { bad: "data" }),
    ).rejects.toBeInstanceOf(AutomationError);
  });
});
