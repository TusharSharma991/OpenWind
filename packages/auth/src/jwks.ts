import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTPayload, KeyLike } from "jose";
import { z } from "zod";
import { env } from "@platform/config";
import { logger } from "@platform/logger";
import {
  assertExternalIssuerEgressAllowed,
  SsrfGuardError,
} from "./ssrf-guard.js";
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

// Third-party API key external-org mapping (docs/specs/third-party-key-external-org-mapping.md)
// -- a key's acting-person tokens may come from an entirely different IdP
// than the platform's configured primary (AUTHNEXUS_ISSUER). This resolves
// JWKS per-issuer via that issuer's own OIDC discovery document, cached
// per-issuer indefinitely (a provider's jwks_uri does not change in normal
// operation the way signing keys inside it do -- those are still bounded by
// createRemoteJWKSet's own cacheMaxAge below).
//
// Deliberately NOT a fork/swap of getJwks() above for a second hardcoded
// provider (that's what this fork's AuthNexus-only swap already did, and is
// exactly the gap this closes) -- this works for any standard-OIDC issuer,
// discovered at call time, not hardcoded per provider.
//
// docs/specs/third-party-key-external-org-mapping.md security review (§B B3):
// unbounded growth here would become a real DoS surface once an admin-set
// `external_issuer` value is wired into the live verification path
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
  issuer: z.string().url(),
  jwks_uri: z.string().url(),
});

async function getJwksForIssuer(issuer: string): Promise<JwksGetter> {
  const cached = _jwksByIssuer.get(issuer);
  if (cached) {
    _touchIssuer(issuer, cached);
    return cached;
  }

  // Security review (docs/specs/third-party-key-external-org-mapping.md):
  // `issuer` is admin-supplied at key-creation time (validated only as
  // `z.string().url()` there, no scheme/host restriction) -- a tenant admin
  // is not a fully-trusted platform operator, so this is a real SSRF vector
  // once a key using it is exercised. create.ts already runs this same check
  // at creation time; it's repeated here as defense-in-depth (DNS/routing can
  // change between creation and use).
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
  // PR #545 review (PrabhuVijit) -- RFC 8414 §3.3: "The issuer value returned
  // MUST be identical to the Issuer URL that was used as the prefix to
  // /.well-known/openid-configuration." Without this check, a misconfigured
  // IdP serving a discovery document for the wrong issuer would silently
  // succeed here and only fail later, confusingly, at jwtVerify's own
  // issuer check on first real token. Failing closed here surfaces the
  // misconfiguration at the point it's introduced.
  if (discovery.issuer !== issuer) {
    throw new Error(
      `OIDC discovery document issuer mismatch: expected "${issuer}", got "${discovery.issuer}"`,
    );
  }
  // jwks_uri is issuer-controlled content, not the already-guarded issuer
  // origin itself -- a compromised/malicious issuer could point it at a
  // third, unrelated internal target. Guarded the same way before it's ever
  // handed to createRemoteJWKSet.
  await assertExternalIssuerEgressAllowed(discovery.jwks_uri);

  // cacheMaxAge stays the same platform-wide constant as getJwks()'s own
  // AuthNexus-tuned value (§B B3 asked this be reconsidered, not necessarily
  // changed) -- per-issuer-configurable rotation cadence would need a new
  // admin-facing setting with no real signal yet for what value to default
  // it to for an arbitrary external IdP; a shorter shared window is a safe
  // default (worst case: extra discovery/JWKS fetches), not a security gap.
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
 * external_issuer (docs/specs/third-party-key-external-org-mapping.md,
 * wired into dual-identity.ts's requireActingPerson).
 *
 * Return type intentionally matches verifyJwtWithAudience's
 * `JWTPayload & AuthNexusClaims` (not a bare `Record<string, unknown>`) even
 * though a non-AuthNexus issuer's token won't populate those fields --
 * they're all optional, so this is a safe over-declaration, and it keeps
 * callers that branch between the two functions (dual-identity.ts) working
 * with one consistent claims type instead of a wider union that loses the
 * specific optional-field types on `.email`/`.name`/etc.
 */
export async function verifyJwtForIssuer(
  token: string,
  issuer: string,
  audience: string,
  // PR #545 review (PrabhuVijit, SUGGESTION) -- optional since this is a
  // pure auth primitive with no tenant context of its own; the caller
  // (dual-identity.ts's requireActingPerson) has auth.tenantId available
  // and threads it through so a failure here can be correlated with other
  // tenant-scoped events during an incident, same as the security.md rule
  // for tenant-scoped logs generally.
  tenantId?: string,
): Promise<(JWTPayload & AuthNexusClaims) | null> {
  try {
    const jwks = await getJwksForIssuer(issuer);
    const { payload } = await jwtVerify(token, jwks as unknown as KeyLike, {
      issuer,
      audience,
      clockTolerance: 5,
      maxTokenAge: env.JWT_MAX_TOKEN_AGE_SECONDS,
    });
    // Same cast as verifyJwtAgainstAudience above -- `sub` is technically
    // optional per jose's JWTPayload but required in AuthNexusClaims; the
    // caller (dual-identity.ts) already checks claims.sub is present before
    // using it, same as it does for the primary-issuer path.
    return payload as JWTPayload & AuthNexusClaims;
  } catch (err) {
    // PR #545 review (PrabhuVijit, GOOD TO FIX) -- an SsrfGuardError here
    // (the issuer resolved to a private/reserved address at verification
    // time, e.g. DNS rebinding between key creation and first use) is a
    // fundamentally different event than an actual JWT signature/claims
    // failure. Logging both under one identical message buried the real
    // cause in the error-string field, forcing an on-call engineer to parse
    // it instead of filtering by log message during incident investigation.
    const isSsrf = err instanceof SsrfGuardError;
    logger.warn(
      { error: String(err), issuer, audience, tenantId },
      isSsrf
        ? "JWT verification blocked — issuer failed SSRF guard at verification time"
        : "JWT verification failed (external issuer)",
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
