import { and, eq, isNull, or } from "drizzle-orm";
import type { DbOrTx } from "@platform/db";
import { entityFields } from "@platform/db";
import { getRedis } from "@platform/redis";
import type { EntityField } from "../types.js";
import { buildZodSchema } from "./schema-builder.js";
import type { z } from "zod";

const CACHE_TTL_SECONDS = 60;

function cacheKey(
  entityTypeId: string,
  tenantId: string,
  mode: "create" | "update",
): string {
  return `schema:${entityTypeId}:${tenantId}:${mode}`;
}

function isRedisReady(): boolean {
  try {
    return getRedis().status === "ready";
  } catch {
    return false;
  }
}

export async function getValidationSchema(
  db: DbOrTx,
  entityTypeId: string,
  tenantId: string,
  mode: "create" | "update",
): Promise<z.ZodObject<Record<string, z.ZodTypeAny>>> {
  const key = cacheKey(entityTypeId, tenantId, mode);

  try {
    if (isRedisReady()) {
      const cached = await getRedis().get(key);
      if (cached) {
        const fields = JSON.parse(cached) as EntityField[];
        return buildZodSchema(fields, mode);
      }
    }
  } catch {
    // Cache miss on Redis error — fall through to DB
  }

  const rows = await db
    .select()
    .from(entityFields)
    .where(
      and(
        eq(entityFields.entityTypeId, entityTypeId),
        or(isNull(entityFields.tenantId), eq(entityFields.tenantId, tenantId)),
      ),
    )
    .orderBy(entityFields.sortOrder);

  const fields: EntityField[] = rows.map((r) => ({
    ...r,
    config: r.config as Record<string, unknown>,
    fieldType: r.fieldType as EntityField["fieldType"],
    sensitivity: r.sensitivity as EntityField["sensitivity"],
  }));

  try {
    if (isRedisReady()) {
      await getRedis().set(
        key,
        JSON.stringify(fields),
        "EX",
        CACHE_TTL_SECONDS,
      );
    }
  } catch {
    // Non-fatal: proceed without caching
  }

  return buildZodSchema(fields, mode);
}

export async function invalidateSchemaCache(
  entityTypeId: string,
  tenantId?: string,
): Promise<void> {
  const pattern = tenantId
    ? `schema:${entityTypeId}:${tenantId}:*`
    : `schema:${entityTypeId}:*`;

  try {
    if (isRedisReady()) {
      const redis = getRedis();
      const keysToDelete: string[] = [];
      let cursor = "0";
      do {
        const [nextCursor, keys] = await redis.scan(
          cursor,
          "MATCH",
          pattern,
          "COUNT",
          "100",
        );
        cursor = nextCursor;
        keysToDelete.push(...keys);
      } while (cursor !== "0");
      if (keysToDelete.length > 0) await redis.del(...keysToDelete);
    }
  } catch {
    // Non-fatal
  }
}
