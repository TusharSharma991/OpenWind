/**
 * GET /admin/audit — paginated audit log query.
 *
 * Admin-only. Supports filtering by actorId, resourceType, resourceId,
 * date range (from/to), and cursor-based pagination (cursor = last row's
 * createdAt ISO string; limit max 100).
 */
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth, requireRole } from "@platform/auth";
import { db } from "@platform/db";
import { adminAuditLog } from "@platform/db";
import { and, eq, gte, lte, lt, desc } from "drizzle-orm";
import { factory } from "./factory.js";

const AuditQuerySchema = z.object({
  actorId: z.string().optional(),
  actorType: z.enum(["user", "api_key", "system"]).optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  /** cursor = ISO timestamp of the last row in the previous page */
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const getAuditLogHandler = factory.createHandlers(
  requireAuth(),
  requireRole("admin"),
  zValidator("query", AuditQuerySchema),
  async (c) => {
    const { tenantId } = c.get("auth");
    const q = c.req.valid("query");

    const conditions = [eq(adminAuditLog.tenantId, tenantId)];

    if (q.actorId !== undefined)
      conditions.push(eq(adminAuditLog.actorId, q.actorId));
    if (q.actorType !== undefined)
      conditions.push(eq(adminAuditLog.actorType, q.actorType));
    if (q.resourceType !== undefined)
      conditions.push(eq(adminAuditLog.resourceType, q.resourceType));
    if (q.resourceId !== undefined)
      conditions.push(eq(adminAuditLog.resourceId, q.resourceId));
    if (q.from !== undefined)
      conditions.push(gte(adminAuditLog.createdAt, new Date(q.from)));
    if (q.to !== undefined)
      conditions.push(lte(adminAuditLog.createdAt, new Date(q.to)));
    if (q.cursor !== undefined)
      conditions.push(lt(adminAuditLog.createdAt, new Date(q.cursor)));

    const rows = await db
      .select()
      .from(adminAuditLog)
      .where(and(...conditions))
      .orderBy(desc(adminAuditLog.createdAt))
      .limit(q.limit + 1); // fetch one extra to determine hasMore

    const hasMore = rows.length > q.limit;
    const items = hasMore ? rows.slice(0, q.limit) : rows;
    const nextCursor =
      hasMore && items.length > 0
        ? items[items.length - 1]?.createdAt.toISOString()
        : null;

    return c.json({ data: items, meta: { hasMore, nextCursor } });
  },
);
