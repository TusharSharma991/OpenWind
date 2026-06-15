import { importPKCS8, SignJWT } from "jose";
import { z } from "zod";
import { env } from "@platform/config";
import { logger } from "@platform/logger";

// ── Types ─────────────────────────────────────────────────────────────────────

const ServiceAccountKeySchema = z.object({
  type: z.string(),
  keyId: z.string(),
  key: z.string(),
  userId: z.string(),
  expirationDate: z.string(),
});

type ServiceAccountKey = z.infer<typeof ServiceAccountKeySchema>;

interface ZitadelRole {
  key: string;
  displayName: string;
  group: string;
}

// ── Token cache ───────────────────────────────────────────────────────────────

let _cachedToken: string | null = null;
let _tokenExpiresAt = 0;

// ── Role cache ────────────────────────────────────────────────────────────────

let _cachedRoles: string[] | null = null;
let _rolesExpiresAt = 0;
const ROLES_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── Parse key ─────────────────────────────────────────────────────────────────

function parseServiceAccountKey(): ServiceAccountKey | null {
  const raw = env.ZITADEL_SERVICE_ACCOUNT_KEY;
  if (!raw) return null;
  try {
    return ServiceAccountKeySchema.parse(JSON.parse(raw));
  } catch {
    logger.error(
      {},
      "Failed to parse ZITADEL_SERVICE_ACCOUNT_KEY — invalid JSON or missing fields",
    );
    return null;
  }
}

// ── Get access token (JWT bearer exchange) ────────────────────────────────────

async function getAccessToken(): Promise<string | null> {
  const now = Date.now();
  if (_cachedToken && now < _tokenExpiresAt - 30_000) return _cachedToken;

  const keyConfig = parseServiceAccountKey();
  if (!keyConfig) return null;

  try {
    // Sign a JWT assertion with the RSA private key
    const privateKey = await importPKCS8(keyConfig.key, "RS256");
    const assertion = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: keyConfig.keyId })
      .setIssuedAt()
      .setIssuer(keyConfig.userId)
      .setSubject(keyConfig.userId)
      .setAudience(env.ZITADEL_ISSUER)
      .setExpirationTime("1h")
      .sign(privateKey);

    // Exchange the JWT assertion for an OAuth access token
    const res = await fetch(`${env.ZITADEL_ISSUER}/oauth/v2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        scope: "openid urn:zitadel:iam:org:project:id:zitadel:iam.write",
        assertion,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      logger.error(
        { status: res.status, body },
        "Zitadel token exchange failed",
      );
      return null;
    }

    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    _cachedToken = data.access_token;
    _tokenExpiresAt = now + data.expires_in * 1000;
    return _cachedToken;
  } catch (err) {
    logger.error({ err }, "Failed to obtain Zitadel service account token");
    return null;
  }
}

// ── List project roles ────────────────────────────────────────────────────────

export async function listProjectRoles(): Promise<string[]> {
  const now = Date.now();
  if (_cachedRoles && now < _rolesExpiresAt) return _cachedRoles;

  const token = await getAccessToken();
  if (!token) return [];

  // Project ID: explicit env var, or fall back to ZITADEL_AUDIENCE (same value in this setup)
  const projectId = env.ZITADEL_PROJECT_ID ?? env.ZITADEL_AUDIENCE;
  if (!projectId) {
    logger.warn(
      {},
      "ZITADEL_PROJECT_ID and ZITADEL_AUDIENCE are both unset — cannot fetch roles",
    );
    return [];
  }

  try {
    const res = await fetch(
      `${env.ZITADEL_ISSUER}/management/v1/projects/${projectId}/roles/_search`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ limit: 200 }),
      },
    );

    if (!res.ok) {
      const body = await res.text();
      logger.error(
        { status: res.status, body },
        "Zitadel list project roles failed",
      );
      return [];
    }

    const data = (await res.json()) as { result?: ZitadelRole[] };
    const roles = (data.result ?? []).map((r) => r.key);
    _cachedRoles = roles;
    _rolesExpiresAt = now + ROLES_TTL_MS;
    return roles;
  } catch (err) {
    logger.error({ err }, "Failed to list Zitadel project roles");
    return [];
  }
}
