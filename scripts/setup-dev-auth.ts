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

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createSign } from "node:crypto";

// ── Config ────────────────────────────────────────────────────────────────────

const ZITADEL_BASE = process.env["ZITADEL_BASE_URL"] ?? "http://localhost:8080";
const ADMIN_EMAIL =
  process.env["ZITADEL_ADMIN_EMAIL"] ?? "admin@platform.local";
// Accept a pre-generated PAT directly (bypasses the auth flow entirely)
const ADMIN_PAT = process.env["ZITADEL_ADMIN_PAT"];

const ENV_FILE_PATH = join(process.cwd(), ".env.local");
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

// ── JWT Profile Grant helpers (authNexus pattern) ────────────────────────────

interface ZitadelKeyJson {
  type: string;
  keyId: string;
  key: string; // RSA private key PEM
  userId: string;
}

function signJwt(
  payload: Record<string, unknown>,
  privateKeyPem: string,
  keyId: string,
): string {
  const b64url = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  const header = b64url({ alg: "RS256", typ: "JWT", kid: keyId });
  const body = b64url(payload);
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${body}`);
  return `${header}.${body}.${signer.sign(privateKeyPem, "base64url")}`;
}

async function getTokenFromKeyJson(keyJson: ZitadelKeyJson): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jwt = signJwt(
    {
      iss: keyJson.userId,
      sub: keyJson.userId,
      aud: [ZITADEL_BASE],
      iat: now,
      exp: now + 60,
    },
    keyJson.key,
    keyJson.keyId,
  );
  const res = await fetch(`${ZITADEL_BASE}/oauth/v2/token`, {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      scope: "openid urn:zitadel:iam:org:project:id:zitadel:aud",
      assertion: jwt,
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`JWT token exchange failed ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

function readKeyJsonFromEnvFile(): ZitadelKeyJson | null {
  // Check process env first (set by docker or CI), then .env.local
  const fromEnv = process.env["ZITADEL_KEY_JSON"];
  const raw =
    fromEnv ??
    (() => {
      if (!existsSync(ENV_FILE_PATH)) return undefined;
      const line = readFileSync(ENV_FILE_PATH, "utf8")
        .split("\n")
        .find((l) => l.startsWith("ZITADEL_KEY_JSON="));
      return line?.slice("ZITADEL_KEY_JSON=".length);
    })();
  if (!raw) return null;
  try {
    return JSON.parse(
      Buffer.from(raw, "base64").toString("utf8"),
    ) as ZitadelKeyJson;
  } catch {
    return null;
  }
}

// ── Step 1: Authenticate ──────────────────────────────────────────────────────
// Priority: ZITADEL_KEY_JSON (JWT Profile grant) → ZITADEL_ADMIN_PAT → fail

async function getAdminToken(): Promise<string> {
  // 1. JWT Profile grant — headless, works after first bootstrap
  const keyJson = readKeyJsonFromEnvFile();
  if (keyJson) {
    log("Authenticating via ZITADEL_KEY_JSON (JWT Profile grant)...");
    return getTokenFromKeyJson(keyJson);
  }

  // 2. PAT — explicit override via env var
  if (ADMIN_PAT) {
    log("Using ZITADEL_ADMIN_PAT directly.");
    return ADMIN_PAT;
  }

  // 3. Neither set — explain what's needed
  fail(
    `No Zitadel credentials found.\n\n` +
      `  Option A (recommended): run \`pnpm bootstrap\` first — it sets up\n` +
      `  ZITADEL_KEY_JSON in .env.local so future runs are fully headless.\n\n` +
      `  Option B: generate a PAT manually:\n` +
      `  1. Open http://localhost:8080\n` +
      `  2. Log in as ${ADMIN_EMAIL} (password from ZITADEL_ADMIN_PASSWORD or docker-compose)\n` +
      `  3. Avatar → Personal Access Tokens → New (no expiry) → copy\n` +
      `  4. Run: ZITADEL_ADMIN_PAT=<token> pnpm setup-auth\n`,
  );
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
    log(`OIDC app "${APP_NAME}" already exists — updating configuration.`);
    try {
      await zitadelFetch(
        `/management/v1/projects/${projectId}/apps/${existing.id}/oidc`,
        token,
        {
          method: "PUT",
          body: JSON.stringify({
            redirectUris: [
              "http://localhost:3001/auth/callback",
              "http://localhost:3000/auth/callback",
            ],
            responseTypes: ["OIDC_RESPONSE_TYPE_CODE"],
            grantTypes: [
              "OIDC_GRANT_TYPE_AUTHORIZATION_CODE",
              "OIDC_GRANT_TYPE_REFRESH_TOKEN",
            ],
            appType: "OIDC_APP_TYPE_WEB",
            authMethodType: "OIDC_AUTH_METHOD_TYPE_BASIC",
            postLogoutRedirectUris: [
              "http://localhost:3001",
              "http://localhost:3001/login",
              "http://localhost:3000",
            ],
            accessTokenType: "OIDC_TOKEN_TYPE_JWT",
            accessTokenRoleAssertion: true,
            idTokenRoleAssertion: true,
            idTokenUserinfoAssertion: true,
            accessTokenLifetime: `${TOKEN_EXPIRY_SECONDS}s`,
            idTokenLifetime: `${TOKEN_EXPIRY_SECONDS}s`,
          }),
        },
      );
      log(`Successfully updated existing OIDC app settings.`);
    } catch (err) {
      log(
        `Warning: could not update existing OIDC app configuration — ${String(err)}`,
      );
    }
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
        redirectUris: [
          "http://localhost:3001/auth/callback",
          "http://localhost:3000/auth/callback",
        ],
        responseTypes: ["OIDC_RESPONSE_TYPE_CODE"],
        grantTypes: [
          "OIDC_GRANT_TYPE_AUTHORIZATION_CODE",
          "OIDC_GRANT_TYPE_REFRESH_TOKEN",
        ],
        appType: "OIDC_APP_TYPE_WEB",
        authMethodType: "OIDC_AUTH_METHOD_TYPE_BASIC",
        postLogoutRedirectUris: [
          "http://localhost:3001",
          "http://localhost:3001/login",
          "http://localhost:3000",
        ],
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

// ── Step 4: Create admin role + grant it to the initial admin user ────────────

async function ensureAdminRoleAndGrant(
  token: string,
  projectId: string,
): Promise<void> {
  // 4a. Create the "admin" role in the project (idempotent)
  log(`Ensuring "admin" role exists in project ${projectId}...`);
  try {
    await zitadelFetch(`/management/v1/projects/${projectId}/roles`, token, {
      method: "POST",
      body: JSON.stringify({
        roleKey: "admin",
        displayName: "Admin",
        group: "platform",
      }),
    });
    log(`Created "admin" role.`);
  } catch (err) {
    const msg = String(err);
    // Zitadel returns 409 / "already exists" when the role is present
    if (msg.includes("409") || msg.toLowerCase().includes("already exist")) {
      log(`"admin" role already exists — skipping.`);
    } else {
      log(`Warning: could not create admin role — ${msg}`);
    }
  }

  // 4b. Find the initial admin user so we can grant them the role
  log(`Looking up admin user (${ADMIN_EMAIL})...`);
  const searchRes = (await zitadelFetch("/management/v1/users/_search", token, {
    method: "POST",
    body: JSON.stringify({
      queries: [
        {
          emailQuery: {
            emailAddress: ADMIN_EMAIL,
            method: "TEXT_QUERY_METHOD_EQUALS",
          },
        },
      ],
    }),
  })) as { result?: Array<{ id: string; userName: string }> };

  const adminUser = searchRes.result?.[0];
  if (!adminUser) {
    log(
      `Warning: could not find user "${ADMIN_EMAIL}" — skipping role grant. ` +
        `Create a user grant manually in Zitadel → Project → Authorizations.`,
    );
    return;
  }

  log(
    `Found admin user (id=${adminUser.id}). Granting "admin" project role...`,
  );

  // 4c. Grant the admin project role to the user (idempotent via conflict ignore)
  try {
    await zitadelFetch(`/management/v1/users/${adminUser.id}/grants`, token, {
      method: "POST",
      body: JSON.stringify({
        projectId,
        roleKeys: ["admin"],
      }),
    });
    log(`Granted "admin" role to ${ADMIN_EMAIL}.`);
  } catch (err) {
    const msg = String(err);
    if (msg.includes("409") || msg.toLowerCase().includes("already exist")) {
      log(`"admin" role already granted to ${ADMIN_EMAIL} — skipping.`);
    } else {
      log(`Warning: could not grant admin role — ${msg}`);
    }
  }
}

// ── Step 5: Create introspection service account ──────────────────────────────

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
    if (v.includes("<existing") && updated.has(k)) {
      // Keep existing value
      continue;
    }
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
  await ensureAdminRoleAndGrant(adminToken, projectId);
  const saUserId = await ensureIntrospectionAccount(adminToken);
  const {
    clientId: introspectionClientId,
    clientSecret: introspectionClientSecret,
  } = await getIntrospectionCredentials(adminToken, projectId, saUserId);

  const issuer = `${ZITADEL_BASE}`;
  const introspectionUrl = `${ZITADEL_BASE}/oauth/v2/introspect`;

  writeEnvLocal({
    ZITADEL_ISSUER: issuer,
    // Zitadel puts the PROJECT ID in the JWT aud claim, not the OIDC client ID.
    ZITADEL_AUDIENCE: projectId,
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
