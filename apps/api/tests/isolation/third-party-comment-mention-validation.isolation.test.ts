/**
 * Isolation tests for POST /api/v1/tickets/:id/comments's `mentions`
 * validation (2026-09-08 policy change).
 *
 * Supersedes third-party-comment-mentions-response-uniformity.isolation.test.ts
 * (deleted), which asserted the OLD behavior this deliberately reverses:
 * mention resolution used to be async-only and never reported back to the
 * caller, specifically to prevent using the mentions list as an org-member
 * enumeration probe (ADR-012 spec R5/R6). That protection was consciously
 * relaxed: every mentioned identifier must now resolve to a real org member
 * or the whole comment is rejected with 422 -- the error reports only that
 * an identifier didn't resolve, never a user list or suggestions, so the
 * failure signal itself doesn't reopen the enumeration leak.
 *
 * Real Postgres connection, RLS + app_user enforced (not mocked).
 * `listOrgUsers` (an external AuthNexus API call) is mocked -- see
 * resolve-org-member.ts.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  tenants,
  workflows,
  workflowStates,
  workflowEvents,
  apiKeys,
} from "@platform/db";
import { createEntityType, createEntity } from "@platform/entity-engine";
import { hashApiKey } from "@platform/auth";
import type { AuthContext, ActingPersonContext } from "@platform/auth";
import { createThirdPartyCommentHandler } from "../../src/routes/third-party/comments.js";

import type * as AuthnexusManagement from "../../src/lib/authnexus-management.js";
vi.mock("../../src/lib/authnexus-management.js", async (importOriginal) => {
  const real = await importOriginal<typeof AuthnexusManagement>();
  return {
    ...real,
    listOrgUsers: async () => [
      {
        userId: "real-user-id-123",
        email: "bob@example.com",
        displayName: "Bob",
        loginName: "bob-username",
      },
    ],
  };
});

const TENANT = "eeeeeeee-0000-4000-e000-000000000805";
const API_KEY_ID = "55555555-5555-5555-5555-555555555556";
const ORIGIN_OIDC_CLIENT_ID = "third-party-mention-validation-test-client";

let entityTypeId: string;
let workflowId: string;
let ticketId: string;

const CREATOR = "third-party-mention-validation-creator";

beforeAll(async () => {
  await db.insert(tenants).values({
    id: TENANT,
    name: "3P Mention Validation Tenant",
    slug: `3p-mention-validation-${TENANT}`,
  });

  await db.insert(apiKeys).values({
    id: API_KEY_ID,
    tenantId: TENANT,
    name: "3P Mention Validation Test Key",
    keyHash: hashApiKey(`sk_3p_mention_validation_test_${TENANT}`),
    scopesFormat: "action",
    scopes: ["entity:ticket:comment"],
    oidcClientId: ORIGIN_OIDC_CLIENT_ID,
  });

  const entityType = await createEntityType(db, null, {
    name: `third_party_mention_validation_test_${Date.now()}`,
    plural: "third_party_mention_validation_tests",
    allowCustomFields: true,
  });
  entityTypeId = entityType.id;

  const [workflow] = await db
    .insert(workflows)
    .values({
      tenantId: TENANT,
      entityTypeId,
      name: "3P Mention Validation Workflow",
      initialState: "open",
    })
    .returning({ id: workflows.id });
  workflowId = workflow!.id;

  await db.insert(workflowStates).values({
    tenantId: TENANT,
    workflowId,
    name: "open",
    label: "Open",
    sortOrder: 0,
  });

  const ticket = await createEntity(db, TENANT, {
    entityTypeId,
    fields: {},
    createdBy: CREATOR,
    workflowId,
    currentState: "open",
  });
  ticketId = ticket.id;
});

afterAll(async () => {
  await db.delete(apiKeys).where(eq(apiKeys.id, API_KEY_ID));
  await db.delete(tenants).where(inArray(tenants.id, [TENANT]));
});

type Vars = {
  Variables: { auth: AuthContext; actingPerson: ActingPersonContext };
};

function makeApp() {
  const app = new Hono<Vars>();
  app.use("*", async (c: Context<Vars>, next: Next) => {
    c.set("auth", {
      userId: "apikey:55555555-5555-5555-5555-555555555556",
      tenantId: TENANT,
      roles: ["entity:ticket:comment"],
      email: "",
      displayName: "API Key 55555555556",
      orgId: "org-eee",
    });
    c.set("actingPerson", {
      userId: CREATOR,
      email: `${CREATOR}@example.com`,
      displayName: CREATOR,
      orgId: "org-eee",
    });
    await next();
  });
  app.post("/:id/comments", ...createThirdPartyCommentHandler);
  return app;
}

async function postComment(text: string, mentions: string[]) {
  const app = makeApp();
  const res = await app.request(`/${ticketId}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, mentions }),
  });
  const body = (await res.json()) as {
    data?: { id: string };
    fields?: { mentions?: string };
  };
  return { status: res.status, body };
}

describe("POST /api/v1/tickets/:id/comments — mentions must resolve to real org members", () => {
  it("succeeds when every mention resolves (by userId, username, or email)", async () => {
    const res = await postComment("re: valid mentions", [
      "real-user-id-123",
      "bob-username",
      "bob@example.com",
    ]);
    expect(res.status).toBe(201);
    expect(res.body.data?.id).toBeTruthy();
  });

  it("succeeds with an empty mentions array (no validation to fail)", async () => {
    const res = await postComment("re: no mentions", []);
    expect(res.status).toBe(201);
  });

  it("rejects with 422 when a mentioned identifier does not resolve to anyone", async () => {
    const res = await postComment("re: bad mention", [
      "totally-unknown-identifier-xyz",
    ]);
    expect(res.status).toBe(422);
    expect(res.body.fields?.mentions).toContain(
      "totally-unknown-identifier-xyz",
    );
  });

  it("the error message names only the unresolved identifier(s), never a valid-user list", async () => {
    const res = await postComment("re: mixed mentions", [
      "real-user-id-123",
      "totally-unknown-identifier-xyz",
    ]);
    expect(res.status).toBe(422);
    // Only the bad identifier is echoed back -- the caller already knows
    // what they sent, so this isn't a leak; the org's real member list
    // (e.g. "bob-username") must never appear here.
    expect(res.body.fields?.mentions).toContain(
      "totally-unknown-identifier-xyz",
    );
    expect(res.body.fields?.mentions).not.toContain("bob-username");
    expect(res.body.fields?.mentions).not.toContain("real-user-id-123");
  });

  it("rejects the whole comment if even one of several mentions is unresolvable — no partial success", async () => {
    const before = await db
      .select()
      .from(workflowEvents)
      .where(eq(workflowEvents.instanceId, ticketId));

    const res = await postComment("re: partial failure", [
      "real-user-id-123",
      "another-unknown-one",
    ]);
    expect(res.status).toBe(422);

    const after = await db
      .select()
      .from(workflowEvents)
      .where(eq(workflowEvents.instanceId, ticketId));
    expect(after.length).toBe(before.length);
  });
});
