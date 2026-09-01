import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTPayload, KeyLike } from "jose";
import { z } from "zod";
import { env } from "@platform/config";
import { logger } from "@platform/logger";
import { assertExternalIssuerEgressAllowed } from "./ssrf-guard.js";
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

// Third-party API key external-org mapping (docs/specs/third-party-key-external-org-mapping.md,
// ported from upstream/tushar's generalized version) -- a key's acting-person
// tokens may come from an entirely different IdP than the platform's
// configured primary (AUTHNEXUS_ISSUER). This resolves JWKS per-issuer via
// that issuer's own OIDC discovery document, cached per-issuer indefinitely
// (a provider's jwks_uri does not change in normal operation the way signing
// keys inside it do -- those are still bounded by createRemoteJWKSet's own
// cacheMaxAge below).
//
// Deliberately NOT a fork/swap of getJwks() above for a second hardcoded
// provider (that's what this fork's AuthNexus-only swap already did, and is
// exactly the gap this closes) -- this works for any standard-OIDC issuer,
// discovered at call time, not hardcoded per provider.
//
// Unbounded growth here would become a real DoS surface once an admin-set
// externalIssuer value is wired into the live verification path (dual-identity.ts)
// -- a tenant with many third-party keys pointed at many distinct (typo'd or
// otherwise) issuers could grow this map without limit. Bounded to a small
// LRU-ish cap: Maps preserve insertion order, and `_touchIssuer` re-inserts
// an entry on every hit to move it to the end, so eviction below always
// drops the actual least-recently-used issuer, not just the oldest-inserted
// one.
const MAX_CACHED_EXTERNAL_ISSUERS = 50;
const _jwksByIssuer = new Map<string, JwksGetter>();

function _touchIssuer(issuer: string, jwks: JwksGetter): void {
  _jwksByIssuer.delete(issuer);
  _jwksByIssuer.set(issuer, jwks);
  if (_jwksByIssuer.size > MAX_CACHED_EXTERNAL_ISSUERS) {
    const oldest = _jwksByIssuer.keys().next().value;
    if (oldest !== undefined) _jwksByIssuer.delete(oldest);
  }
}

const OidcDiscoverySchema = z.object({
  jwks_uri: z.string().url(),
});

async function getJwksForIssuer(issuer: string): Promise<JwksGetter> {
  const cached = _jwksByIssuer.get(issuer);
  if (cached) {
    _touchIssuer(issuer, cached);
    return cached;
  }

  // Security review finding: `issuer` is admin-supplied at key-creation time
  // (validated only as `z.string().url()` there, no scheme/host restriction)
  // -- a tenant admin is not a fully-trusted platform operator, so this is a
  // real SSRF vector once a key using it is exercised. create.ts already
  // runs this same check at creation time; it's repeated here as
  // defense-in-depth (DNS/routing can change between creation and use).
  await assertExternalIssuerEgressAllowed(issuer);

  const res = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!res.ok) {
    throw new Error(
      `OIDC discovery failed for issuer ${issuer}: ${res.status}`,
    );
  }
  // External input (security.md: connector/3rd-party responses are always
  // Zod-validated, never trusted via a bare type assertion) -- a malformed
  // or malicious discovery document fails closed here instead of producing
  // a confusing downstream error from new URL(undefined) or similar.
  const discovery = OidcDiscoverySchema.parse(await res.json());
  // jwks_uri is issuer-controlled content, not the already-guarded issuer
  // origin itself -- a compromised/malicious issuer could point it at a
  // third, unrelated internal target. Guarded the same way before it's ever
  // handed to createRemoteJWKSet.
  await assertExternalIssuerEgressAllowed(discovery.jwks_uri);

  const jwks = createRemoteJWKSet(new URL(discovery.jwks_uri), {
    cacheMaxAge: 60 * 60 * 1000,
  });
  _touchIssuer(issuer, jwks);
  return jwks;
}

/**
 * Same verification shape as verifyJwtWithAudience (signature, issuer,
 * audience, 5s clock tolerance, max-token-age freshness), but against an
 * explicit, caller-supplied issuer instead of the platform-wide
 * AUTHNEXUS_ISSUER. Used when a third-party API key has its own registered
 * external_issuer (wired into dual-identity.ts's requireActingPerson).
 */
export async function verifyJwtForIssuer(
  token: string,
  issuer: string,
  audience: string,
): Promise<(JWTPayload & AuthNexusClaims) | null> {
  try {
    const jwks = await getJwksForIssuer(issuer);
    const { payload } = await jwtVerify(token, jwks as unknown as KeyLike, {
      issuer,
      audience,
      clockTolerance: 5,
      maxTokenAge: env.JWT_MAX_TOKEN_AGE_SECONDS,
    });
    return payload as JWTPayload & AuthNexusClaims;
  } catch (err) {
    logger.warn(
      { error: String(err), issuer, audience },
      "JWT verification failed (external issuer)",
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
