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

// ADR-012 Phase G, spec R6 — independent of `exp`-based expiry: rejects a
// token whose `iat` is older than this, even if the IdP's own exp says it's
// still valid. Config-driven (not hardcoded) so it stays reviewable/tunable
// without a code change; startup warns if ever configured above 30 minutes
// (see packages/config/src/env.ts).

async function verifyJwtAgainstAudience(
  token: string,
  audience: string | string[],
  options?: { enforceMaxTokenAge?: boolean },
): Promise<(JWTPayload & AuthNexusClaims) | null> {
  try {
    const { payload } = await jwtVerify(
      token,
      getJwks() as unknown as KeyLike,
      {
        issuer: env.AUTHNEXUS_ISSUER,
        // jose's `audience` option already matches whether the token's own
        // `aud` claim is a single string or an array — no separate branching
        // needed for either legal JWT form.
        audience,
        // 5 s is sufficient to absorb NTP clock skew between containers.
        // A wider tolerance extends the replay window for stolen tokens
        // past their stated expiry for no real benefit. (#255)
        clockTolerance: 5,
        // Only the third-party acting-person path (verifyJwtWithAudience)
        // opts into this -- the regular human-login JWT path (verifyJwt)
        // deliberately does not, so a long-lived legitimate human session
        // isn't newly broken by a check aimed at third-party token freshness.
        ...(options?.enforceMaxTokenAge
          ? { maxTokenAge: env.JWT_MAX_TOKEN_AGE_SECONDS }
          : {}),
      },
    );
    return payload as JWTPayload & AuthNexusClaims;
  } catch (err) {
    logger.warn(
      { error: String(err), issuer: env.AUTHNEXUS_ISSUER, audience },
      "JWT verification failed",
    );
    return null;
  }
}

export async function verifyJwt(
  token: string,
): Promise<(JWTPayload & AuthNexusClaims) | null> {
  // AUTHNEXUS_AUDIENCE is required and non-empty (packages/config/src/env.ts),
  // so audience validation is always enforced here.
  return verifyJwtAgainstAudience(token, env.AUTHNEXUS_AUDIENCE);
}

/**
 * Same signature/issuer/expiry verification as verifyJwt, but against a
 * caller-supplied audience instead of the platform-wide AUTHNEXUS_AUDIENCE.
 *
 * ADR-012 Phase B: the acting-person token presented alongside a third-party
 * API key is minted for *that third-party application's own AuthNexus login*,
 * never for OpenWind itself — so it will never carry AUTHNEXUS_AUDIENCE. Its
 * `aud` must instead be checked against the specific API key's own
 * registered `oidc_client_id` (Round 5 correction of an earlier,
 * incorrect Round 4 fix that compared against OpenWind's own client ID — no
 * legitimate third-party token would ever match that value).
 */
export async function verifyJwtWithAudience(
  token: string,
  audience: string,
): Promise<(JWTPayload & AuthNexusClaims) | null> {
  return verifyJwtAgainstAudience(token, audience, {
    enforceMaxTokenAge: true,
  });
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
