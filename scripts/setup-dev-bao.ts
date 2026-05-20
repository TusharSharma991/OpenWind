#!/usr/bin/env tsx
/**
 * setup-dev-bao.ts
 *
 * Bootstraps OpenBao AppRole authentication for local development.
 *
 * What it does:
 *  1. Verifies the OpenBao dev container is healthy
 *  2. Enables the AppRole auth method (idempotent — skips if already enabled)
 *  3. Creates a policy granting encrypt/decrypt access to the platform-credentials
 *     Transit key (the key itself is created by the openbao-init docker container)
 *  4. Creates an AppRole role bound to that policy
 *  5. Reads the RoleID and generates a new SecretID
 *  6. Writes / updates .env.local with OPENBAO_* env vars
 *
 * Prerequisites:
 *   docker compose up -d      (starts openbao + openbao-init)
 *   OPENBAO_DEV_ROOT_TOKEN    environment variable (default: dev-root-token)
 *
 * Run once after `docker compose up -d`:
 *   pnpm setup-bao
 *
 * Re-running is safe — it detects existing resources and skips creation,
 * but always generates a fresh SecretID and updates .env.local.
 */

import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ── Config ────────────────────────────────────────────────────────────────────

const OPENBAO_ADDR = process.env["OPENBAO_ADDR"] ?? "http://localhost:8200";
const ROOT_TOKEN = process.env["OPENBAO_DEV_ROOT_TOKEN"] ?? "dev-root-token";
// Transit key created by docker-compose openbao-init container
const TRANSIT_KEY = "platform-credentials";
const TRANSIT_MOUNT = "transit";
const APPROLE_MOUNT = "approle";
const POLICY_NAME = "platform-api";
const ROLE_NAME = "platform-api";
const FETCH_TIMEOUT_MS = 15_000;

const ENV_FILE = join(process.cwd(), ".env.local");

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg: string): void {
  console.log(`[setup-bao] ${msg}`);
}

function fail(msg: string): never {
  console.error(`[setup-bao] ERROR: ${msg}`);
  process.exit(1);
}

async function baoFetch(
  path: string,
  options: {
    method?: string;
    body?: unknown;
  } = {},
): Promise<unknown> {
  const url = `${OPENBAO_ADDR}${path}`;
  const res = await fetch(url, {
    method: options.method ?? "GET",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      "Content-Type": "application/json",
      "X-Vault-Token": ROOT_TOKEN,
    },
    body:
      options.body !== null && options.body !== undefined
        ? JSON.stringify(options.body)
        : undefined,
  });

  // 404 has a special meaning in Vault/OpenBao: resource doesn't exist yet
  if (res.status === 404) return null;

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `${options.method ?? "GET"} ${url} → ${res.status}: ${body}`,
    );
  }

  const text = await res.text();
  return text.length > 0 ? (JSON.parse(text) as unknown) : null;
}

// ── Step 1: Health check ──────────────────────────────────────────────────────

async function checkHealth(): Promise<void> {
  log(`Connecting to OpenBao at ${OPENBAO_ADDR}...`);
  const res = await fetch(`${OPENBAO_ADDR}/v1/sys/health`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }).catch((err: unknown) => {
    fail(
      `Cannot reach OpenBao at ${OPENBAO_ADDR} — is 'docker compose up -d' running? (${String(err)})`,
    );
  });

  // OpenBao dev mode returns 200; initialised-but-unsealed returns 200;
  // sealed or uninitialised returns other codes but we treat them as unhealthy.
  if (res.status !== 200) {
    fail(
      `OpenBao health check returned ${res.status} — expected 200 (dev mode). ` +
        `Wait for 'docker compose up -d' to finish initialising.`,
    );
  }
  log("OpenBao is healthy.");
}

// ── Step 2: Enable AppRole auth ───────────────────────────────────────────────

async function ensureAppRoleEnabled(): Promise<void> {
  log("Checking AppRole auth method...");

  const mounts = (await baoFetch("/v1/sys/auth")) as Record<
    string,
    { type: string }
  > | null;

  const mountKey = `${APPROLE_MOUNT}/`;
  if (mounts?.[mountKey]?.type === "approle") {
    log("AppRole auth already enabled — skipping.");
    return;
  }

  await baoFetch(`/v1/sys/auth/${APPROLE_MOUNT}`, {
    method: "POST",
    body: { type: "approle" },
  });
  log("AppRole auth enabled.");
}

// ── Step 3: Create policy ─────────────────────────────────────────────────────

async function ensurePolicy(): Promise<void> {
  log(`Ensuring policy "${POLICY_NAME}"...`);

  const existing = await baoFetch(`/v1/sys/policies/acl/${POLICY_NAME}`);
  if (existing !== null) {
    log(
      `Policy "${POLICY_NAME}" already exists — updating to latest definition.`,
    );
  }

  // Transit encrypt and decrypt are both "update" operations in OpenBao/Vault.
  const policy = [
    `path "${TRANSIT_MOUNT}/encrypt/${TRANSIT_KEY}" {`,
    `  capabilities = ["update"]`,
    `}`,
    `path "${TRANSIT_MOUNT}/decrypt/${TRANSIT_KEY}" {`,
    `  capabilities = ["update"]`,
    `}`,
  ].join("\n");

  await baoFetch(`/v1/sys/policies/acl/${POLICY_NAME}`, {
    method: "PUT",
    body: { policy },
  });
  log(`Policy "${POLICY_NAME}" written.`);
}

// ── Step 4: Create AppRole role ───────────────────────────────────────────────

async function ensureRole(): Promise<void> {
  log(`Ensuring AppRole role "${ROLE_NAME}"...`);

  const existing = await baoFetch(
    `/v1/auth/${APPROLE_MOUNT}/role/${ROLE_NAME}`,
  );
  if (existing !== null) {
    log(`Role "${ROLE_NAME}" already exists — skipping creation.`);
    return;
  }

  await baoFetch(`/v1/auth/${APPROLE_MOUNT}/role/${ROLE_NAME}`, {
    method: "POST",
    body: {
      policies: [POLICY_NAME],
      // SecretIDs do not expire in dev; tighten in production
      secret_id_ttl: "0",
      token_ttl: "1h",
      token_max_ttl: "4h",
    },
  });
  log(`Role "${ROLE_NAME}" created.`);
}

// ── Step 5: Read RoleID ───────────────────────────────────────────────────────

async function getRoleId(): Promise<string> {
  log("Reading RoleID...");
  const res = (await baoFetch(
    `/v1/auth/${APPROLE_MOUNT}/role/${ROLE_NAME}/role-id`,
  )) as { data?: { role_id?: string } } | null;

  const roleId = res?.data?.role_id;
  if (!roleId) fail(`Could not read role_id for role "${ROLE_NAME}"`);
  log(`RoleID: ${roleId}`);
  return roleId;
}

// ── Step 6: Generate SecretID ─────────────────────────────────────────────────

async function generateSecretId(): Promise<string> {
  log("Generating new SecretID (previous SecretID is invalidated)...");
  const res = (await baoFetch(
    `/v1/auth/${APPROLE_MOUNT}/role/${ROLE_NAME}/secret-id`,
    { method: "POST", body: {} },
  )) as { data?: { secret_id?: string } } | null;

  const secretId = res?.data?.secret_id;
  if (!secretId) fail(`Could not generate secret_id for role "${ROLE_NAME}"`);
  log("SecretID generated.");
  return secretId;
}

// ── Step 7: Write .env.local ──────────────────────────────────────────────────

function writeEnvLocal(vars: Record<string, string>): void {
  let existing = "";
  try {
    existing = readFileSync(ENV_FILE, "utf8");
  } catch (err) {
    // File does not exist yet — start with an empty string.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

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
    "# Generated / updated by scripts/setup-dev-bao.ts",
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
  await checkHealth();
  await ensureAppRoleEnabled();
  await ensurePolicy();
  await ensureRole();

  const roleId = await getRoleId();
  const secretId = await generateSecretId();

  writeEnvLocal({
    OPENBAO_ADDR,
    OPENBAO_ROLE_ID: roleId,
    OPENBAO_SECRET_ID: secretId,
    OPENBAO_TRANSIT_KEY: TRANSIT_KEY,
    OPENBAO_TRANSIT_MOUNT: TRANSIT_MOUNT,
  });

  console.log("\n✅  OpenBao bootstrap complete. Next steps:");
  console.log(
    "   1. The OPENBAO_* vars are now in .env.local — restart the API: pnpm dev",
  );
  console.log("   2. Run pnpm setup-auth if you haven't set up Zitadel yet.");
  console.log(
    "   3. Note: a new SecretID is generated on every run of this script.\n",
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
