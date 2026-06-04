import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTPayload, KeyLike } from "jose";
import { env } from "@platform/config";
import { logger } from "@platform/logger";
import type { ZitadelClaims } from "./types.js";

type JwksGetter = ReturnType<typeof createRemoteJWKSet>;

let _jwks: JwksGetter | undefined;

function getJwks(): JwksGetter {
  if (!_jwks) {
    // ZITADEL_JWKS_URL lets the API container fetch keys via the Docker-internal
    // hostname (e.g. http://zitadel:8080) while still validating the iss claim
    // against ZITADEL_ISSUER (http://localhost:8080 as seen by the browser).
    // env.ZITADEL_JWKS_URL is optional — TypeScript can't narrow through the Zod .refine() wrapper

    const jwksUri = new URL(
      (env.ZITADEL_JWKS_URL ?? `${env.ZITADEL_ISSUER}/oauth/v2/keys`) as string,
    );
    _jwks = createRemoteJWKSet(jwksUri);
  }
  return _jwks;
}

export async function verifyJwt(
  token: string,
): Promise<(JWTPayload & ZitadelClaims) | null> {
  try {
    const { payload } = await jwtVerify(
      token,
      getJwks() as unknown as KeyLike,
      {
        issuer: env.ZITADEL_ISSUER,
        // Zitadel puts the PROJECT ID in aud, not the OIDC client ID.
        // Skip audience validation unless ZITADEL_AUDIENCE is explicitly set to the project ID.
        // Signature + issuer verification is the primary security guard.
        ...(env.ZITADEL_AUDIENCE ? { audience: env.ZITADEL_AUDIENCE } : {}),
      },
    );
    return payload as JWTPayload & ZitadelClaims;
  } catch (err) {
    logger.warn(
      {
        error: String(err),
        issuer: env.ZITADEL_ISSUER,
        audience: env.ZITADEL_AUDIENCE ?? "(not set)",
      },
      "JWT verification failed",
    );
    return null;
  }
}

export function extractAuthContext(claims: JWTPayload & ZitadelClaims): {
  userId: string;
  tenantId: string;
  roles: string[];
  email: string;
} | null {
  const userId = claims.sub;
  const orgId = claims["urn:zitadel:iam:org:id"];

  // In dev, the Zitadel instance admin has no org-scoped token.
  // Fall back to DEV_TENANT_ID so the admin can work without a full org setup.
  const tenantId =
    orgId ?? (env.NODE_ENV !== "production" ? env.DEV_TENANT_ID : undefined);

  if (!userId || !tenantId) return null;

  // Flatten all role names across all projects
  const rolesMap = claims["urn:zitadel:iam:org:project:roles"] ?? {};
  const roles = Object.keys(rolesMap);

  return {
    userId,
    tenantId,
    roles,
    email: claims.email ?? "",
  };
}
