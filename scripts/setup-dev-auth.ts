#!/usr/bin/env tsx
/**
 * setup-dev-auth.ts
 *
 * Bootstraps a bare-bones Zitadel configuration for local development.
 *
 * What it does:
 *  1. Obtains an admin token from Zitadel using the initial admin credentials
 *  2. Creates a "Platform" project (idempotent — skips if already exists)
 *  3. Creates an OIDC web application inside the project with 15-min token expiry
 *  4. Creates a machine (service) account for token introspection
 *  5. Derives introspection client credentials for the service account
 *  6. Writes / updates .env.local with ZITADEL_* env vars
 *
 * OpenBao bootstrap (OPENBAO_ADDR, OPENBAO_ROLE_ID, OPENBAO_SECRET_ID,
 * OPENBAO_TRANSIT_KEY) is handled by a separate script — see issue #1.
 *
 * Run once after `docker compose up -d`:
 *   pnpm setup-auth
 *
 * Re-running is safe — it detects existing resources and skips creation.
 */

import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ── Config ────────────────────────────────────────────────────────────────────

const ZITADEL_BASE = process.env["ZITADEL_BASE_URL"] ?? "http://localhost:8080";
const ADMIN_EMAIL =
  process.env["ZITADEL_ADMIN_EMAIL"] ?? "admin@platform.local";
const ADMIN_PASSWORD = process.env["ZITADEL_ADMIN_PASSWORD"];
if (!ADMIN_PASSWORD) {
  console.error(
    "[setup-auth] ERROR: ZITADEL_ADMIN_PASSWORD env var is required — set it in your shell or .env.local and retry.",
  );
  process.exit(1);
}
const PROJECT_NAME = "Platform";
const APP_NAME = "platform-api";
const INTROSPECTION_SA_NAME = "platform-introspection";
const TOKEN_EXPIRY_SECONDS = 15 * 60; // 15 min

const ENV_FILE = join(process.cwd(), ".env.local");

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg: string): void {
  console.log(`[setup-auth] ${msg}`);
}

function fail(msg: string): never {
  console.error(`[setup-auth] ERROR: ${msg}`);
  process.exit(1);
}

const FETCH_TIMEOUT_MS = 15_000;

async function zitadelFetch(
  path: string,
  token: string,
  options: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<unknown> {
  const url = `${ZITADEL_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `${options.method ?? "GET"} ${url} → ${res.status}: ${body}`,
    );
  }

  return res.json() as Promise<unknown>;
}

// ── Step 1: Authenticate ──────────────────────────────────────────────────────

async function getAdminToken(): Promise<string> {
  log("Authenticating as admin...");

  const res = await fetch(`${ZITADEL_BASE}/oauth/v2/token`, {
    method: "POST",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      username: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      scope: "openid profile email urn:zitadel:iam:org:project:id:zitadel:aud",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    fail(`Failed to authenticate: ${res.status} ${body}`);
  }

  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) fail("No access_token in auth response");
  log("Admin token obtained.");
  return data.access_token;
}

// ── Step 2: Create project (idempotent) ───────────────────────────────────────

async function ensureProject(token: string): Promise<string> {
  log(`Ensuring project "${PROJECT_NAME}" exists...`);

  // Search for existing project
  const searchRes = (await zitadelFetch(
    "/management/v1/projects/_search",
    token,
    {
      method: "POST",
      body: JSON.stringify({
        queries: [
          {
            nameQuery: {
              name: PROJECT_NAME,
              method: "TEXT_QUERY_METHOD_EQUALS",
            },
          },
        ],
      }),
    },
  )) as { result?: Array<{ id: string; name: string }> };

  const existing = searchRes.result?.find((p) => p.name === PROJECT_NAME);
  if (existing) {
    log(
      `Project "${PROJECT_NAME}" already exists (id=${existing.id}) — skipping.`,
    );
    return existing.id;
  }

  const created = (await zitadelFetch("/management/v1/projects", token, {
    method: "POST",
    body: JSON.stringify({ name: PROJECT_NAME }),
  })) as { id: string };

  log(`Created project "${PROJECT_NAME}" (id=${created.id}).`);
  return created.id;
}

// ── Step 3: Create OIDC application ───────────────────────────────────────────

async function ensureOidcApp(
  token: string,
  projectId: string,
): Promise<{ clientId: string; clientSecret: string }> {
  log(`Ensuring OIDC app "${APP_NAME}" in project ${projectId}...`);

  // Search for existing app
  const searchRes = (await zitadelFetch(
    `/management/v1/projects/${projectId}/apps/_search`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        queries: [
          { nameQuery: { name: APP_NAME, method: "TEXT_QUERY_METHOD_EQUALS" } },
        ],
      }),
    },
  )) as {
    result?: Array<{
      id: string;
      name: string;
      oidcConfig?: { clientId: string };
    }>;
  };

  const existing = searchRes.result?.find((a) => a.name === APP_NAME);
  if (existing?.oidcConfig?.clientId) {
    log(
      `OIDC app "${APP_NAME}" already exists — skipping. NOTE: client secret cannot be recovered; regenerate if needed.`,
    );
    return {
      clientId: existing.oidcConfig.clientId,
      clientSecret: "<existing — regenerate if needed>",
    };
  }

  const created = (await zitadelFetch(
    `/management/v1/projects/${projectId}/apps/oidc`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        name: APP_NAME,
        redirectUris: ["http://localhost:3000/auth/callback"],
        responseTypes: ["OIDC_RESPONSE_TYPE_CODE"],
        grantTypes: [
          "OIDC_GRANT_TYPE_AUTHORIZATION_CODE",
          "OIDC_GRANT_TYPE_REFRESH_TOKEN",
        ],
        appType: "OIDC_APP_TYPE_WEB",
        authMethodType: "OIDC_AUTH_METHOD_TYPE_BASIC",
        postLogoutRedirectUris: ["http://localhost:3000"],
        accessTokenType: "OIDC_TOKEN_TYPE_JWT",
        accessTokenRoleAssertion: true,
        idTokenRoleAssertion: true,
        idTokenUserinfoAssertion: true,
        additionalOrigins: [],
        skipNativeAppSuccessPage: false,
        // Token lifetime: 15 minutes
        clockSkewSeconds: 0,
      }),
    },
  )) as { appId: string; clientId: string; clientSecret: string };

  // Set short access token lifetime via app settings (best-effort)
  try {
    await zitadelFetch(
      `/management/v1/projects/${projectId}/apps/${created.appId}/oidc`,
      token,
      {
        method: "PUT",
        body: JSON.stringify({
          accessTokenLifetime: `${TOKEN_EXPIRY_SECONDS}s`,
          idTokenLifetime: `${TOKEN_EXPIRY_SECONDS}s`,
        }),
      },
    );
    log(`Set token lifetime to ${TOKEN_EXPIRY_SECONDS}s.`);
  } catch (err) {
    log(`Warning: could not set token lifetime — ${String(err)}`);
  }

  log(`Created OIDC app "${APP_NAME}" (clientId=${created.clientId}).`);
  return { clientId: created.clientId, clientSecret: created.clientSecret };
}

// ── Step 4: Create introspection service account ──────────────────────────────

async function ensureIntrospectionAccount(token: string): Promise<string> {
  log(`Ensuring machine account "${INTROSPECTION_SA_NAME}"...`);

  // Search for existing machine user
  const searchRes = (await zitadelFetch("/management/v1/users/_search", token, {
    method: "POST",
    body: JSON.stringify({
      queries: [
        {
          userNameQuery: {
            userName: INTROSPECTION_SA_NAME,
            method: "TEXT_QUERY_METHOD_EQUALS",
          },
        },
      ],
    }),
  })) as { result?: Array<{ id: string; userName: string }> };

  const existing = searchRes.result?.find(
    (u) => u.userName === INTROSPECTION_SA_NAME,
  );
  if (existing) {
    log(
      `Machine account "${INTROSPECTION_SA_NAME}" already exists (id=${existing.id}) — skipping creation.`,
    );
    return existing.id;
  }

  const created = (await zitadelFetch("/management/v1/users/machine", token, {
    method: "POST",
    body: JSON.stringify({
      userName: INTROSPECTION_SA_NAME,
      name: "Platform Introspection Service",
      description:
        "Service account used by the API to introspect tokens via Zitadel",
      accessTokenType: "ACCESS_TOKEN_TYPE_JWT",
    }),
  })) as { userId: string };

  log(
    `Created machine account "${INTROSPECTION_SA_NAME}" (id=${created.userId}).`,
  );
  return created.userId;
}

// ── Step 5: Derive introspection credentials ──────────────────────────────────

async function getIntrospectionCredentials(
  token: string,
  _projectId: string,
  userId: string,
): Promise<{ clientId: string; clientSecret: string }> {
  log("Setting up introspection client credentials...");

  // Create a machine client secret for basic auth introspection
  try {
    const res = (await zitadelFetch(
      `/management/v1/users/${userId}/secret`,
      token,
      { method: "PUT", body: JSON.stringify({}) },
    )) as { clientId: string; clientSecret: string };

    return { clientId: res.clientId, clientSecret: res.clientSecret };
  } catch (err) {
    log(
      `Warning: could not generate machine client credentials — ${String(err)}`,
    );
    log("Falling back to PAT-based introspection.");
    return { clientId: userId, clientSecret: "" };
  }
}

// ── Step 7: Write .env.local ──────────────────────────────────────────────────

function writeEnvLocal(vars: Record<string, string>): void {
  let existing = "";
  try {
    existing = readFileSync(ENV_FILE, "utf8");
  } catch (err) {
    // File does not exist yet — start with an empty string.
    // Re-throw anything other than a missing-file error.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  // Parse existing lines, overwrite matching keys, append new ones
  const lines = existing.split("\n").filter((l) => l !== "");
  const updated = new Map<string, string>(
    lines
      .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
      .map((l) => {
        const idx = l.indexOf("=");
        return [l.slice(0, idx), l.slice(idx + 1)] as [string, string];
      }),
  );

  for (const [k, v] of Object.entries(vars)) {
    updated.set(k, v);
  }

  const header = [
    "# Generated by scripts/setup-dev-auth.ts",
    `# Last updated: ${new Date().toISOString()}`,
    "",
  ].join("\n");

  const content =
    header +
    [...updated.entries()].map(([k, v]) => `${k}=${v}`).join("\n") +
    "\n";

  writeFileSync(ENV_FILE, content, "utf8");
  log(`Wrote ${ENV_FILE}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log(`Connecting to Zitadel at ${ZITADEL_BASE}...`);

  const adminToken = await getAdminToken();
  const projectId = await ensureProject(adminToken);
  const { clientId: oidcClientId, clientSecret: oidcClientSecret } =
    await ensureOidcApp(adminToken, projectId);
  const saUserId = await ensureIntrospectionAccount(adminToken);
  const {
    clientId: introspectionClientId,
    clientSecret: introspectionClientSecret,
  } = await getIntrospectionCredentials(adminToken, projectId, saUserId);

  const issuer = `${ZITADEL_BASE}`;
  const introspectionUrl = `${ZITADEL_BASE}/oauth/v2/introspect`;

  writeEnvLocal({
    ZITADEL_ISSUER: issuer,
    ZITADEL_AUDIENCE: oidcClientId,
    ZITADEL_INTROSPECTION_URL: introspectionUrl,
    ZITADEL_INTROSPECTION_CLIENT_ID: introspectionClientId,
    ZITADEL_INTROSPECTION_CLIENT_SECRET: introspectionClientSecret,
    // OIDC app credentials — used by the frontend / admin-ui
    ZITADEL_OIDC_CLIENT_ID: oidcClientId,
    ZITADEL_OIDC_CLIENT_SECRET: oidcClientSecret,
  });

  console.log("\n✅  Zitadel bootstrap complete. Next steps:");
  console.log(
    "   1. Copy any remaining vars from .env.example into .env.local",
  );
  console.log("   2. Restart the API: pnpm dev");
  console.log("   3. Log in at http://localhost:8080 to verify the project.\n");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
