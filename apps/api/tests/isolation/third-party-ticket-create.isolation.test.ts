/**
 * Isolation tests for POST /api/v1/tickets (ADR-012 Phase B, PR B3,
 * spec R6/R8/R9/R11/R13/R14).
 *
 * Real Postgres connection, RLS + app_user enforced (not mocked). As in the
 * other third-party isolation suites, `actingPerson` is set directly via a
 * stub middleware — the thing under test here is this route's own
 * force-to-initial-state, scope, actor-identity, and payload-guard behavior.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { eq, and, sql } from "drizzle-orm";
import {
  db,
  tenants,
  workflows,
  workflowStates,
  workflowEvents,
  outboxEvents,
  adminAuditLog,
  apiKeys,
  withTenantContext,
} from "@platform/db";
import {
  createEntityType,
  registerEntityAuditHook,
} from "@platform/entity-engine";
import { writeAuditEntry } from "@platform/audit";
import { hashApiKey } from "@platform/auth";
import type { AuthContext, ActingPersonContext } from "@platform/auth";
import { createThirdPartyTicketHandler } from "../../src/routes/third-party/tickets.js";

// assignedTo now resolves against a real AuthNexus org-users lookup (an
// external service call, not the database -- mocking it here follows
// testing-conventions.md's "mock at service boundaries, never the DB" rule).
// "some-assignee" (REQUIRED_BASELINE_FIELDS below) resolves to itself so
// every existing assertion against that literal string keeps working.
import type * as AuthnexusManagement from "../../src/lib/authnexus-management.js";
vi.mock("../../src/lib/authnexus-management.js", async (importOriginal) => {
  const real = await importOriginal<typeof AuthnexusManagement>();
  return {
    ...real,
    listOrgUsers: async () => [
      {
        userId: "some-assignee",
        email: "some-assignee@example.com",
        displayName: "some-assignee",
        loginName: "some-assignee",
      },
      // Distinct userId/loginName pair -- proves username resolution
      // actually maps to the canonical id, not just an identity function
      // (which "some-assignee" above can't distinguish, since its userId
      // and loginName happen to be the same string).
      {
        userId: "real-user-id-999",
        email: "bob@example.com",
        displayName: "Bob",
        loginName: "bob-username",
      },
    ],
  };
});

const TENANT = "12121212-0000-4000-a000-000000000506";
const API_KEY_ID = "33333333-3333-3333-3333-333333333333";
const ORIGIN_OIDC_CLIENT_ID = "third-party-ticket-create-test-client";

let entityTypeId: string;
let workflowId: string;
const createdInstanceIds: string[] = [];

beforeAll(async () => {
  // This test builds a bare Hono app directly from the route handler and
  // never imports apps/api/src/app.ts, so app.ts's own module-load-time
  // registerEntityAuditHook call never runs — mirror that exact wiring here
  // so the "records actor_type/acting_person_id" test below can observe a
  // real audit row from the real creation flow, not a hand-inserted one.
  registerEntityAuditHook(async (p) => {
    await writeAuditEntry(p.db, {
      tenantId: p.tenantId,
      actorId: p.actorId,
      actorType: p.actorType,
      actingPersonId: p.actingPersonId,
      resourceType: p.resourceType,
      resourceId: p.resourceId,
      action: p.action,
      beforeSnapshot: p.beforeSnapshot,
      afterSnapshot: p.afterSnapshot,
      entityFields: p.entityFields,
    });
  });

  await db.insert(tenants).values({
    id: TENANT,
    name: "3P Ticket Create Tenant",
    slug: `3p-ticket-create-${TENANT}`,
  });

  // docs/specs/third-party-api-origin-tagging.md — the create route now
  // resolves the authenticating key's oidcClientId (resolveOriginOidcClientId)
  // via a real DB lookup, not just the stubbed auth context above. Matches
  // apiKeyAuth()'s synthetic "apikey:33333333-..." id so that lookup succeeds
  // the same way it would for a genuinely authenticated request.
  await db.insert(apiKeys).values({
    id: API_KEY_ID,
    tenantId: TENANT,
    name: "3P Ticket Create Test Key",
    keyHash: hashApiKey(`sk_3p_ticket_create_test_${TENANT}`),
    scopesFormat: "action",
    scopes: ["entity:ticket:create"],
    oidcClientId: ORIGIN_OIDC_CLIENT_ID,
  });

  const entityType = await createEntityType(db, null, {
    name: `third_party_ticket_create_test_${Date.now()}`,
    plural: "third_party_ticket_create_tests",
    allowCustomFields: true,
  });
  entityTypeId = entityType.id;

  const [workflow] = await db
    .insert(workflows)
    .values({
      tenantId: TENANT,
      entityTypeId,
      name: "3P Ticket Create Workflow",
      initialState: "open",
    })
    .returning({ id: workflows.id });
  workflowId = workflow!.id;

  await db.insert(workflowStates).values([
    { tenantId: TENANT, workflowId, name: "open", label: "Open", sortOrder: 0 },
    {
      tenantId: TENANT,
      workflowId,
      name: "closed",
      label: "Closed",
      isTerminal: true,
      sortOrder: 1,
    },
  ]);
});

afterAll(async () => {
  // admin_audit_log is append-only by design — app_user has no DELETE grant
  // on it (see @platform/audit's own module doc), so cleanup must go
  // through the bare/superuser db connection, same as
  // audit-log.isolation.test.ts's own teardown.
  await db.delete(adminAuditLog).where(eq(adminAuditLog.tenantId, TENANT));
  await db.delete(apiKeys).where(eq(apiKeys.id, API_KEY_ID));
  await db.delete(tenants).where(eq(tenants.id, TENANT));
});

type Vars = {
  Variables: { auth: AuthContext; actingPerson: ActingPersonContext };
};

function makeApp(auth: AuthContext, actingPerson: ActingPersonContext) {
  const app = new Hono<Vars>();
  app.use("*", async (c: Context<Vars>, next: Next) => {
    c.set("auth", auth);
    c.set("actingPerson", actingPerson);
    await next();
  });
  app.post("/", ...createThirdPartyTicketHandler);
  return app;
}

function apiKeyAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: "apikey:33333333-3333-3333-3333-333333333333",
    tenantId: TENANT,
    roles: ["entity:ticket:create"],
    email: "",
    displayName: "API Key 33333333",
    orgId: "org-121",
    ...overrides,
  };
}

// Mandatory-baseline-fields policy (2026-09-07): assignedTo/dueDate/remark
// are required on every third-party ticket-create request now
// (CreateThirdPartyTicketSchema) -- every request body below needs valid
// values for all three, same as a real integration now has to send.
const REQUIRED_BASELINE_FIELDS = {
  assignedTo: "some-assignee",
  dueDate: "2026-12-01T00:00:00.000Z",
  remark: "test remark",
};

const ACTING_PERSON: ActingPersonContext = {
  userId: "third-party-ticket-creator",
  email: "creator@example.com",
  displayName: "Third Party Creator",
  orgId: "org-121",
};

describe("POST /api/v1/tickets", () => {
  it("creates a ticket into the workflow's initial state, ignoring any state field sent", async () => {
    const app = makeApp(apiKeyAuth(), ACTING_PERSON);
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflowId,
        fields: { title: "Test ticket" },
        state: "closed",
        currentState: "closed",
        ...REQUIRED_BASELINE_FIELDS,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { id: string; currentState: string; createdBy: string };
    };
    createdInstanceIds.push(body.data.id);
    expect(body.data.currentState).toBe("open");
    expect(body.data.createdBy).toBe(ACTING_PERSON.userId);
  });

  it("applies an optional assignee", async () => {
    const app = makeApp(apiKeyAuth(), ACTING_PERSON);
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflowId,
        fields: {},
        ...REQUIRED_BASELINE_FIELDS,
        assignedTo: "some-assignee",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { id: string; assignedTo: string };
    };
    createdInstanceIds.push(body.data.id);
    expect(body.data.assignedTo).toBe("some-assignee");
  });

  it("records actor_type=api_key plus a populated acting_person_id distinct from actor_id", async () => {
    const app = makeApp(apiKeyAuth(), ACTING_PERSON);
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflowId,
        fields: {},
        ...REQUIRED_BASELINE_FIELDS,
      }),
    });
    const body = (await res.json()) as { data: { id: string } };
    createdInstanceIds.push(body.data.id);

    const [entry] = await withTenantContext(TENANT, (tx) =>
      tx
        .select({
          actorType: adminAuditLog.actorType,
          actorId: adminAuditLog.actorId,
          actingPersonId: adminAuditLog.actingPersonId,
        })
        .from(adminAuditLog)
        .where(
          and(
            eq(adminAuditLog.resourceId, body.data.id),
            eq(adminAuditLog.action, "created"),
          ),
        )
        .limit(1),
    );

    expect(entry?.actorType).toBe("api_key");
    expect(entry?.actingPersonId).toBe(ACTING_PERSON.userId);
    // Bug: createEntity's audit hook used to stamp actor_id with createdBy
    // (the acting person) instead of the key's own application-actor id,
    // even though actorType was correctly "api_key" — admin/third-party-
    // access-logs.ts then failed trying to look up that non-uuid person id
    // as an api_keys.id. actor_id must be the key, distinct from both
    // actor_type and acting_person_id above.
    expect(entry?.actorId).toBe("33333333-3333-3333-3333-333333333333");
    expect(entry?.actorId).not.toBe(ACTING_PERSON.userId);
  });

  it("rejects a key without the entity:ticket:create scope", async () => {
    const app = makeApp(
      apiKeyAuth({ roles: ["entity:ticket:read"] }),
      ACTING_PERSON,
    );
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflowId,
        fields: {},
        ...REQUIRED_BASELINE_FIELDS,
      }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects a fields payload containing a null byte", async () => {
    const app = makeApp(apiKeyAuth(), ACTING_PERSON);
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflowId,
        fields: { title: `bad${String.fromCharCode(0)}value` },
        ...REQUIRED_BASELINE_FIELDS,
      }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("VALIDATION_ERROR");
  });

  it("rejects a fields payload exceeding the size guard", async () => {
    const app = makeApp(apiKeyAuth(), ACTING_PERSON);
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflowId,
        fields: { blob: "x".repeat(200_000) },
        ...REQUIRED_BASELINE_FIELDS,
      }),
    });
    expect(res.status).toBe(422);
  });

  it("rejects a fields payload nested deeper than the depth guard", async () => {
    let deeplyNested: unknown = "leaf";
    for (let i = 0; i < 12; i++) {
      deeplyNested = { nested: deeplyNested };
    }
    const app = makeApp(apiKeyAuth(), ACTING_PERSON);
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflowId,
        fields: { deep: deeplyNested },
        ...REQUIRED_BASELINE_FIELDS,
      }),
    });
    expect(res.status).toBe(422);
  });

  it("returns 404 for a workflowId that doesn't belong to this tenant", async () => {
    const app = makeApp(apiKeyAuth(), ACTING_PERSON);
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflowId: "00000000-0000-4000-a000-000000000000",
        fields: {},
        ...REQUIRED_BASELINE_FIELDS,
      }),
    });
    expect(res.status).toBe(404);
  });
});

// Mandatory-baseline-fields policy (2026-09-07): assignedTo/dueDate/remark
// are required on every ticket, on every workflow, no exceptions -- a
// platform-wide invariant, not a per-workflow toggle. Previously these were
// either optional or (dueDate/remark) not even accepted by this endpoint at
// all, so the only enforcement was admin-ui's client-side form check
// (record-create.tsx), trivially bypassed by a direct API call like this one.
describe("POST /api/v1/tickets — mandatory baseline fields", () => {
  it("returns 400 when assignedTo is missing", async () => {
    const app = makeApp(apiKeyAuth(), ACTING_PERSON);
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflowId,
        fields: { title: "Missing assignedTo" },
        dueDate: "2026-12-01T00:00:00.000Z",
        remark: "test remark",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when dueDate is missing", async () => {
    const app = makeApp(apiKeyAuth(), ACTING_PERSON);
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflowId,
        fields: { title: "Missing dueDate" },
        assignedTo: "some-assignee",
        remark: "test remark",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when remark is missing", async () => {
    const app = makeApp(apiKeyAuth(), ACTING_PERSON);
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflowId,
        fields: { title: "Missing remark" },
        assignedTo: "some-assignee",
        dueDate: "2026-12-01T00:00:00.000Z",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("creates successfully and persists dueDate/remark when all baseline fields are present", async () => {
    const app = makeApp(apiKeyAuth(), ACTING_PERSON);
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflowId,
        fields: { title: "All baseline fields present" },
        assignedTo: "some-assignee",
        dueDate: "2026-12-01T00:00:00.000Z",
        remark: "Please expedite",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { id: string; assignedTo: string; dueDate: string; remark: string };
    };
    createdInstanceIds.push(body.data.id);
    expect(body.data.assignedTo).toBe("some-assignee");
    expect(body.data.dueDate).toContain("2026-12-01");
    expect(body.data.remark).toBe("Please expedite");
  });

  // Security review (2026-09-08): remark is inserted verbatim as the
  // ticket's first comment (workflow_events.metadata.text), the exact same
  // sink comments.ts's own `text` field guards against control characters
  // -- this proves remark now gets the identical ingress-level guard,
  // rather than reaching that sink unchecked via this second entry point.
  it("returns 400 when remark contains a null byte or control character", async () => {
    const app = makeApp(apiKeyAuth(), ACTING_PERSON);
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflowId,
        fields: { title: "Control char in remark" },
        assignedTo: "some-assignee",
        dueDate: "2026-12-01T00:00:00.000Z",
        remark: "bad\x00remark",
      }),
    });
    expect(res.status).toBe(400);
  });

  // Security review (2026-09-08): an unresolved assignedTo is now echoed
  // verbatim into a system-generated comment's text (postSystemComment) --
  // the same workflow_events.metadata.text sink remark's own guard
  // protects, so assignedTo needs the identical control-character guard.
  it("returns 400 when assignedTo contains a null byte or control character", async () => {
    const app = makeApp(apiKeyAuth(), ACTING_PERSON);
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflowId,
        fields: { title: "Control char in assignedTo" },
        assignedTo: "bad\x00assignee",
        dueDate: "2026-12-01T00:00:00.000Z",
        remark: "test remark",
      }),
    });
    expect(res.status).toBe(400);
  });
});

// Found via manual testing against a real client org's production instance:
// assignedTo was stored verbatim with zero validation, so a caller-supplied
// username silently landed in assigned_to and never matched any real user in
// admin-ui's own lookup (which keys strictly on userId) -- the ticket just
// looked unassigned, with no error surfaced anywhere.
describe("POST /api/v1/tickets — assignedTo resolves username or userId to the canonical userId", () => {
  it("accepts a raw userId and stores it as-is", async () => {
    const app = makeApp(apiKeyAuth(), ACTING_PERSON);
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflowId,
        fields: { title: "assignedTo as raw userId" },
        assignedTo: "real-user-id-999",
        dueDate: "2026-12-01T00:00:00.000Z",
        remark: "test remark",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { id: string; assignedTo: string };
    };
    createdInstanceIds.push(body.data.id);
    expect(body.data.assignedTo).toBe("real-user-id-999");
  });

  it("accepts a username (loginName) and resolves it to the canonical userId", async () => {
    const app = makeApp(apiKeyAuth(), ACTING_PERSON);
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflowId,
        fields: { title: "assignedTo as username" },
        assignedTo: "bob-username",
        dueDate: "2026-12-01T00:00:00.000Z",
        remark: "test remark",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { id: string; assignedTo: string };
    };
    createdInstanceIds.push(body.data.id);
    // The stored value is the canonical userId, NOT the username submitted --
    // this is exactly what makes admin-ui's AssignDropdown (matches strictly
    // on userId) able to find and display the assignment correctly.
    expect(body.data.assignedTo).toBe("real-user-id-999");
  });

  // Policy (2026-09-08, revised from an earlier 422-on-failure design):
  // an unresolvable assignedTo no longer blocks creation or shows up as a
  // synchronous error -- the ticket is always created (unassigned here),
  // and the caller learns about the failure only via a system-generated
  // reply comment notifying the acting person who created the ticket. See
  // post-system-comment.ts for the full rationale (this closes the fast,
  // scriptable "does this identifier exist" oracle a 422 response here
  // would otherwise be).
  it("creates the ticket unassigned (never 422s) when assignedTo matches no real org member, and posts a System Agent reply notifying the creator", async () => {
    const app = makeApp(apiKeyAuth(), ACTING_PERSON);
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflowId,
        fields: { title: "assignedTo unresolvable" },
        assignedTo: "nobody-with-this-username",
        dueDate: "2026-12-01T00:00:00.000Z",
        remark: "test remark",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { id: string; assignedTo: string | null };
    };
    createdInstanceIds.push(body.data.id);
    expect(body.data.assignedTo).toBeNull();

    const events = await withTenantContext(TENANT, (tx) =>
      tx
        .select({
          actorId: workflowEvents.actorId,
          metadata: workflowEvents.metadata,
        })
        .from(workflowEvents)
        .where(eq(workflowEvents.instanceId, body.data.id)),
    );
    const systemReply = events.find(
      (e) =>
        e.actorId === "system" &&
        (e.metadata as { text?: string } | null)?.text?.includes(
          "nobody-with-this-username",
        ),
    );
    expect(systemReply).toBeTruthy();
    expect(
      (systemReply?.metadata as { actorName?: string } | null)?.actorName,
    ).toBe("system");
    // Replies to the remark comment (this test's request included a
    // remark), which is what makes the existing comment.replied
    // notification path fire for the ticket's own creator.
    expect(
      (systemReply?.metadata as { replyTo?: string } | null)?.replyTo,
    ).toBeTruthy();

    const [replyOutbox] = await withTenantContext(TENANT, (tx) =>
      tx
        .select({ payload: outboxEvents.payload })
        .from(outboxEvents)
        .where(eq(outboxEvents.eventType, "comment.replied")),
    );
    expect(
      (replyOutbox?.payload as { targetUserId?: string } | undefined)
        ?.targetUserId,
    ).toBe(ACTING_PERSON.userId);
  });
});

// Found via the same manual testing session: entities/create.ts (the
// admin-ui's own create route) posts `remark` as the ticket's first comment
// ("this becomes the first comment" in the UI), but this third-party route
// only ever stored it on the instance's own column -- an API-created
// ticket's remark was invisible in the Comments tab/timeline, unlike a
// human-created one.
describe("POST /api/v1/tickets — remark is posted as the ticket's first comment", () => {
  it("creates a workflow_events comment row containing the remark text", async () => {
    const app = makeApp(apiKeyAuth(), ACTING_PERSON);
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflowId,
        fields: { title: "remark-as-first-comment test" },
        assignedTo: "some-assignee",
        dueDate: "2026-12-01T00:00:00.000Z",
        remark: "This should appear as the first comment",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string } };
    createdInstanceIds.push(body.data.id);

    const [event] = await withTenantContext(TENANT, (tx) =>
      tx
        .select({ metadata: workflowEvents.metadata })
        .from(workflowEvents)
        .where(
          and(
            eq(workflowEvents.instanceId, body.data.id),
            sql`${workflowEvents.metadata}->>'type' = 'comment'`,
          ),
        )
        .limit(1),
    );
    expect(event?.metadata).toMatchObject({
      type: "comment",
      text: "This should appear as the first comment",
    });
  });
});
