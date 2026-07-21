import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTPayload, KeyLike } from "jose";
import { env } from "@platform/config";
import { logger } from "@platform/logger";
import type { AuthNexusClaims, AuthContext } from "./types.js";

type JwksGetter = ReturnType<typeof createRemoteJWKSet>;

let _jwks: JwksGetter | undefined;

function getJwks(): JwksGetter {
  _jwks ??= createRemoteJWKSet(new URL(env.AUTHNEXUS_JWKS_URL));
  return _jwks;
}

export async function verifyJwt(
  token: string,
): Promise<(JWTPayload & AuthNexusClaims) | null> {
  try {
    const { payload } = await jwtVerify(
      token,
      getJwks() as unknown as KeyLike,
      {
        issuer: env.AUTHNEXUS_ISSUER,
        // AuthNexus puts the PROJECT ID in aud, not the OIDC client ID.
        // AUTHNEXUS_AUDIENCE is required and non-empty (packages/config/src/env.ts),
        // so audience validation is always enforced here.
        audience: env.AUTHNEXUS_AUDIENCE,
        // Allow up to 30 s of clock skew between AuthNexus and the API container.
        // Without this, tokens with nbf = "now" fail if the server clock is a
        // few seconds behind AuthNexus, causing 401s on the very first request
        // after login before the client retries with a refreshed token.
        clockTolerance: 30,
      },
    );
    return payload as JWTPayload & AuthNexusClaims;
  } catch (err) {
    logger.warn(
      {
        error: String(err),
        issuer: env.AUTHNEXUS_ISSUER,
        audience: env.AUTHNEXUS_AUDIENCE,
      },
      "JWT verification failed",
    );
    return null;
  }
}

export function extractAuthContext(
  claims: JWTPayload & AuthNexusClaims,
): AuthContext | null {
  const userId = claims.sub;
  const orgId = claims.org_id;

  // In dev, always use DEV_TENANT_ID so all users (admin + org members) hit
  // the same seeded tenant. AuthNexus org UUIDs in the JWT would otherwise map
  // to non-existent tenants and return empty data for portal users.
  const tenantId =
    env.NODE_ENV !== "production" ? (env.DEV_TENANT_ID ?? orgId) : orgId;

  if (!userId || !tenantId) return null;

  // Roles are per-project, under nexus_projects[].roles — pull only the grant
  // for our own project (the aud claim holds the client id, not the project
  // id, so we can't rely on that to scope this).
  const projectGrant = (claims.nexus_projects ?? []).find(
    (p) => p.id === env.AUTHNEXUS_PROJECT_ID,
  );
  const roles = projectGrant?.roles ?? [];

  const displayName =
    claims.name ?? claims.preferred_username ?? claims.email ?? userId;

  return {
    userId,
    tenantId,
    roles,
    email: claims.email ?? "",
    displayName,
    orgId,
  };
}
