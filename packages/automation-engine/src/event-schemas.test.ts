import { describe, it, expect } from "vitest";
import {
  TriggerEventSchema,
  WorkflowTransitionedV1Schema,
  EntityCreatedV1Schema,
  EntityAssignedV1Schema,
  EntityUnassignedV1Schema,
} from "./event-schemas.js";

// AuthNexus issues numeric-string user ids (e.g. "382580897309786115"), not
// UUIDs. These fields previously required .uuid(), so every real
// entity.assigned/entity.unassigned/workflow.transitioned/entity.created
// event dead-lettered with INVALID_EVENT_PAYLOAD in production.
const AUTHNEXUS_USER_ID = "382580897309786115";

describe("event-schemas — non-UUID identity-provider user ids", () => {
  it("accepts a non-UUID actorId on workflow.transitioned", () => {
    const result = WorkflowTransitionedV1Schema.safeParse({
      version: 1,
      tenantId: "00000000-0000-0000-0000-000000000001",
      eventType: "workflow.transitioned",
      instanceId: "8777e91f-c2ae-4fca-aa74-dd1de68999f2",
      entityTypeId: "fce99cb9-b81d-41d3-80f6-abf0d5530a26",
      workflowId: "fce99cb9-b81d-41d3-80f6-abf0d5530a27",
      fromState: "open",
      toState: "closed",
      triggeredBy: "user",
      actorId: AUTHNEXUS_USER_ID,
      occurredAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("accepts a non-UUID createdBy on entity.created", () => {
    const result = EntityCreatedV1Schema.safeParse({
      version: 1,
      tenantId: "00000000-0000-0000-0000-000000000001",
      eventType: "entity.created",
      instanceId: "8777e91f-c2ae-4fca-aa74-dd1de68999f2",
      entityTypeId: "fce99cb9-b81d-41d3-80f6-abf0d5530a26",
      fields: {},
      createdBy: AUTHNEXUS_USER_ID,
    });
    expect(result.success).toBe(true);
  });

  it("accepts non-UUID assigneeId/assignedBy on entity.assigned", () => {
    const result = EntityAssignedV1Schema.safeParse({
      version: 1,
      tenantId: "00000000-0000-0000-0000-000000000001",
      eventType: "entity.assigned",
      instanceId: "8777e91f-c2ae-4fca-aa74-dd1de68999f2",
      entityTypeId: "fce99cb9-b81d-41d3-80f6-abf0d5530a26",
      assigneeId: "374487847148716035",
      assignedBy: AUTHNEXUS_USER_ID,
    });
    expect(result.success).toBe(true);
  });

  it("accepts non-UUID previousAssigneeId/actorId on entity.unassigned", () => {
    const result = EntityUnassignedV1Schema.safeParse({
      version: 1,
      tenantId: "00000000-0000-0000-0000-000000000001",
      eventType: "entity.unassigned",
      instanceId: "8777e91f-c2ae-4fca-aa74-dd1de68999f2",
      entityTypeId: "fce99cb9-b81d-41d3-80f6-abf0d5530a26",
      previousAssigneeId: "372447581956997123",
      actorId: AUTHNEXUS_USER_ID,
    });
    expect(result.success).toBe(true);
  });

  it("parses a real dead-lettered entity.assigned payload via the discriminated union", () => {
    const result = TriggerEventSchema.safeParse({
      version: 1,
      tenantId: "00000000-0000-0000-0000-000000000001",
      eventType: "entity.assigned",
      assignedBy: "382580897309786115",
      assigneeId: "374487847148716035",
      instanceId: "8777e91f-c2ae-4fca-aa74-dd1de68999f2",
      entityTypeId: "fce99cb9-b81d-41d3-80f6-abf0d5530a26",
    });
    expect(result.success).toBe(true);
  });

  it("parses a real dead-lettered entity.unassigned payload via the discriminated union", () => {
    const result = TriggerEventSchema.safeParse({
      actorId: "382580897309786115",
      version: 1,
      tenantId: "00000000-0000-0000-0000-000000000001",
      eventType: "entity.unassigned",
      instanceId: "8777e91f-c2ae-4fca-aa74-dd1de68999f2",
      entityTypeId: "fce99cb9-b81d-41d3-80f6-abf0d5530a26",
      previousAssigneeId: "372447581956997123",
    });
    expect(result.success).toBe(true);
  });

  it("still rejects a missing required field", () => {
    const result = EntityAssignedV1Schema.safeParse({
      version: 1,
      tenantId: "00000000-0000-0000-0000-000000000001",
      eventType: "entity.assigned",
      instanceId: "8777e91f-c2ae-4fca-aa74-dd1de68999f2",
      entityTypeId: "fce99cb9-b81d-41d3-80f6-abf0d5530a26",
      assignedBy: null,
      // assigneeId missing
    });
    expect(result.success).toBe(false);
  });
});
