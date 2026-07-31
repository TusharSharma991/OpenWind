import { z } from "zod";
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Load .env.local from the monorepo root (walk up from cwd until we find it)
function findEnvLocal(): string | undefined {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, ".env.local");
    if (existsSync(candidate)) return candidate;
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

const envLocalPath = findEnvLocal();
if (envLocalPath) {
  loadDotenv({ path: envLocalPath, override: false });
}

// Derive CORS_ORIGIN from APP_URL if not already set.
// Individual vars still take priority when set explicitly (??= never overwrites).
const _raw = process.env as Record<string, string | undefined>;
if (_raw["APP_URL"]) {
  _raw["CORS_ORIGIN"] ??= _raw["APP_URL"];
}

const EnvSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    // APP_URL: the URL the frontend is served from. Drives CORS_ORIGIN.
    //   Local dev default: http://localhost:10406
    //   Production:        https://openwind-nexus.rokkalabs.com
    APP_URL: z.string().url().optional(),
    DATABASE_URL: z.string().url(),
    DATABASE_POOL_MIN: z.coerce.number().int().min(1).default(2),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),
    REDIS_URL: z.string().url(),
    // AuthNexus (external OIDC provider) — no discovery document, so every
    // endpoint is set explicitly rather than derived from one issuer URL.
    AUTHNEXUS_ISSUER: z.string().url(),
    AUTHNEXUS_JWKS_URL: z.string().url(),
    // Required — used by JWKS middleware to validate the JWT aud claim.
    // AuthNexus puts the OIDC client id in aud (confirmed against a real
    // token), not a Zitadel-style project urn — despite the project-scoped
    // urn:zitadel:iam:... scope name requested at login.
    // .min(1): an empty string would otherwise pass z.string() and silently
    // disable audience validation at runtime (jwks.ts) instead of failing
    // closed here at boot.
    AUTHNEXUS_AUDIENCE: z.string().min(1),
    // AuthNexus project id — used to select which nexus_projects[] grant's
    // roles apply to this app (a user may belong to multiple projects).
    AUTHNEXUS_PROJECT_ID: z.string().min(1),
    // M2M service-account key (JWT-bearer grant, AuthNexus wraps Zitadel so
    // this is the identical grant/key shape Zitadel itself uses) — for
    // background contexts with no user session to forward (e.g. apps/worker's
    // notification-outbound-worker resolving a recipient's email via
    // packages/auth/src/authnexus-management.ts's getUserById). Optional:
    // callers without this configured just get null instead of a crash.
    AUTHNEXUS_SERVICE_ACCOUNT_KEY: z.string().optional(),
    // Org id required alongside any M2M grant request (AuthNexus/Zitadel's
    // /api/v1/auth/m2m endpoint rejects the request without it) — previously
    // only wired as a frontend/Vite var, never validated here.
    AUTHNEXUS_ORG_ID: z.string().optional(),
    // The underlying Zitadel instance's own address — the `aud` an M2M
    // assertion must be signed for so the server that actually verifies the
    // signature (Zitadel, not the AuthNexus API wrapper) accepts it. Distinct
    // from AUTHNEXUS_ISSUER (the public AuthNexus API origin our app talks
    // to for everything else) — confirmed via a real M2M token exchange
    // returning 401 "Invalid or unsigned service assertion" when the
    // assertion's aud was set to AUTHNEXUS_ISSUER instead of this value.
    // Optional: M2M callers without this configured just fail to mint a
    // token (existing null/no-op fallback), not a crash.
    AUTHNEXUS_ZITADEL_AUD: z.string().optional(),
    // Dev fallback: used as tenantId when the org claim is absent (instance admin login).
    // Must never be set in production — it bypasses tenant isolation for instance-admin logins.
    DEV_TENANT_ID: z.string().optional(),
    // Required in production — the exact origin the admin-ui is served from.
    // In development/test the API accepts all http://localhost:* origins.
    CORS_ORIGIN: z.string().url().optional(),
    NOVU_API_KEY: z.string(),
    // In-app notification hub (docs/specs/in-app-notification-hub.md).
    // Single hardcoded admin recipient for system.error notifications — role
    // membership isn't queryable from our DB today (roles are JWT-only
    // claims from Zitadel), so this is a deliberate placeholder until proper
    // admin-role resolution is built. Editable at any time; optional so a
    // tenant without one configured just gets no system.error recipients.
    SYSTEM_ADMIN_USER_ID: z.string().optional(),
    // Outbound handoff seam to the externally-owned email/SMS/WhatsApp
    // service. Contract is unresolved as of this feature — when unset, the
    // outbound worker logs and marks the notification 'sent' as a no-op
    // rather than retrying forever against a service that doesn't exist yet.
    NOTIFICATION_SERVICE_URL: z.string().url().optional(),
    // S2S auth for the outbound handoff (docs/notification-outbound-contract.md's
    // auth section) — a DEDICATED AuthNexus machine user/key, deliberately
    // separate from AUTHNEXUS_SERVICE_ACCOUNT_KEY (which authenticates as
    // openwind-api-bot for the admin/management API). Never share this key
    // with the outbound service — it only ever mints tokens on our side; the
    // outbound service verifies them via AuthNexus's public JWKS, it never
    // needs the private key itself.
    NOTIFICATION_AUTHNEXUS_KEY_JSON: z.string().optional(),
    // The dedicated AuthNexus project ID the M2M token's `aud` claim must
    // contain (requested via scope urn:zitadel:iam:org:project:id:<id>:aud —
    // AuthNexus mirrors Zitadel's scope naming). A project separate from the
    // main app project, deliberately, so a human end-user's own access token
    // can never satisfy the outbound service's audience check (see
    // docs/notification-outbound-contract.md).
    NOTIFICATION_AUTHNEXUS_AUDIENCE: z.string().optional(),
    S3_ENDPOINT: z.string().url(),
    // Public URL browsers use to reach MinIO. In Docker the internal endpoint is
    // http://minio:9000 but presigned URLs must resolve from the browser, so set
    // this to http://localhost:9000 (or the CDN/proxy URL in production).
    S3_PUBLIC_URL: z.string().url().optional(),
    S3_BUCKET: z.string(),
    S3_ACCESS_KEY: z.string(),
    S3_SECRET_KEY: z.string(),
    // Local-disk file storage (replaces presigned S3 URLs — see
    // docs/specs/local-disk-file-storage.md). In-container path only; the
    // host-side bind-mount source is FILES_STORAGE_PATH_HOST, a
    // docker-compose-only var never read by application code.
    FILES_STORAGE_PATH: z.string().default("/data/files"),
    ANTHROPIC_API_KEY: z.string(),
    // SSRF protection — comma-separated extra CIDR ranges to block on outbound webhooks
    // (hardcoded RFC 1918 / loopback / link-local ranges are always blocked regardless)
    SSRF_BLOCK_CIDRS: z
      .string()
      .optional()
      .transform((v) =>
        v
          ? v
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
      ),
    // ClamAV — virus scanning for uploaded files (2A platform services)
    CLAMAV_HOST: z.string().default("localhost"),
    CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
    // Set to "true" in dev when ClamAV is not running — files skip the queue and are marked clean immediately
    SKIP_AV_SCAN: z
      .string()
      .transform((v) => v === "true")
      .default("false"),
    // OpenBao — Transit envelope encryption for connector credentials
    OPENBAO_ADDR: z.string().url(),
    OPENBAO_TRANSIT_KEY: z.string().default("platform-credentials"),
    // Dev: static root token. Prod: leave unset and use AppRole instead.
    OPENBAO_TOKEN: z.string().optional(),
    // AppRole auth (production) — both required together when OPENBAO_TOKEN is absent
    OPENBAO_ROLE_ID: z.string().optional(),
    OPENBAO_SECRET_ID: z.string().optional(),
  })
  .refine(
    (v) =>
      v.OPENBAO_TOKEN !== undefined ||
      (v.OPENBAO_ROLE_ID !== undefined && v.OPENBAO_SECRET_ID !== undefined),
    {
      message:
        "Either OPENBAO_TOKEN (dev) or both OPENBAO_ROLE_ID and OPENBAO_SECRET_ID (prod) must be set",
    },
  )
  .refine(
    (v) => !(v.NODE_ENV === "production" && v.DEV_TENANT_ID !== undefined),
    {
      message:
        "DEV_TENANT_ID must not be set in production — it bypasses tenant isolation",
    },
  )
  .refine((v) => v.NODE_ENV !== "production" || v.CORS_ORIGIN !== undefined, {
    message:
      "CORS_ORIGIN must be set in production to restrict allowed origins",
  })
  .refine((v) => !(v.NODE_ENV === "production" && v.SKIP_AV_SCAN), {
    message:
      "SKIP_AV_SCAN must not be true in production — it marks every upload clean without running antivirus scanning",
  });

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
