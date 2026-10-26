/**
 * GET /public/org-branding/:slug -- the login page's brand lookup (R13,
 * docs/specs/multi-org-sandbox.md). UNAUTHENTICATED: the visitor has not signed in, so there is
 * no tenant context and nothing to key a limit on but the client address.
 *
 * What it must never do (§V): tell an unknown slug from a real tenant, a non-active sandbox or a
 * malformed slug (one 404, one body, none cached); return more than `name` and `logo`; read the
 * database before the slug has passed validation; or go without a limit of its own.
 */
import { z } from "zod";
import { db, tenants } from "@platform/db";
import { and, eq } from "drizzle-orm";
import { rateLimitKey } from "../../middleware/rate-limit.js";
import { enforcePublicBrandingRateLimit } from "../../lib/rate-limit-tiers.js";
import { factory } from "./factory.js";

// Lowercase letters, digits and single dashes, as the provisioning worker's slugify() makes them
// (`<name>-<4 digits>`); the cap keeps an absurd value from ever reaching a query.
const SlugSchema = z
  .string()
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

const NOT_FOUND = { error: "NOT_FOUND", message: "Not found" } as const;

export const getOrgBrandingBySlugHandler = factory.createHandlers(async (c) => {
  const limit = await enforcePublicBrandingRateLimit(rateLimitKey(c));
  if (!limit.allowed) {
    c.header("Cache-Control", "no-store");
    return c.json({ error: "RATE_LIMITED", message: "Too many requests" }, 429);
  }

  // A malformed slug is the same 404 as an unknown one, and is refused before any query.
  const slug = SlugSchema.safeParse(c.req.param("slug"));
  if (!slug.success) {
    c.header("Cache-Control", "no-store");
    return c.json(NOT_FOUND, 404);
  }

  // `tenants` has no RLS policy in any migration, so these explicit filters are the only guard:
  // only an active sandbox is ever answered, never a real customer's tenant.
  const [row] = await db
    .select({ name: tenants.name, logo: tenants.logo })
    .from(tenants)
    .where(
      and(
        eq(tenants.slug, slug.data),
        eq(tenants.isSandbox, true),
        eq(tenants.status, "active"),
      ),
    )
    .limit(1);
  if (!row) {
    c.header("Cache-Control", "no-store");
    return c.json(NOT_FOUND, 404);
  }

  // A hit may be cached briefly, so a name or logo edit shows within a minute; a miss never is,
  // so a sandbox created a moment ago works at once.
  c.header("Cache-Control", "public, max-age=60");
  return c.json({ data: { name: row.name, logo: row.logo } });
});
