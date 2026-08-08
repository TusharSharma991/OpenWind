import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTPayload, KeyLike } from "jose";
import { env } from "@platform/config";
import { logger } from "@platform/logger";
import type { AuthNexusClaims, AuthContext } from "./types.js";

type JwksGetter = ReturnType<typeof createRemoteJWKSet>;

let _jwks: JwksGetter | undefined;

function getJwks(): JwksGetter {
  // Refresh cached JWKS after 1 hour so a rotated/revoked signing key stops
  // being accepted within a bounded window. Without this the cache is
  // infinite and key rotation requires a process restart. (#262)
  _jwks ??= createRemoteJWKSet(new URL(env.AUTHNEXUS_JWKS_URL), {
    cacheMaxAge: 60 * 60 * 1000,
  });
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
        // 5 s is sufficient to absorb NTP clock skew between containers.
        // A wider tolerance extends the replay window for stolen tokens
        // past their stated expiry for no real benefit. (#255)
        clockTolerance: 5,
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
