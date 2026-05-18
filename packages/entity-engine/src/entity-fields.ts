import { eq, and, asc, gt, or, isNull } from "drizzle-orm";
import type { DbOrTx } from "@platform/db";
import { entityFields } from "@platform/db";
import { logger } from "@platform/logger";
import type { EntityField } from "./types.js";
import { EntityError } from "./errors.js";
import { invalidateSchemaCache } from "./validation/index.js";
import {
  encodeCursor,
  decodeCursor,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "./pagination.js";
import type { CursorPage } from "./pagination.js";

export type UpdateEntityFieldInput = {
  label?: string | undefined;
  config?: Record<string, unknown> | undefined;
  isRequired?: boolean | undefined;
  sortOrder?: number | undefined;
};

export type ListEntityFieldsInput = {
  cursor?: string | undefined;
  limit?: number | undefined;
};

export async function listEntityFields(
  db: DbOrTx,
  tenantId: string,
  entityTypeId: string,
  input: ListEntityFieldsInput = {},
): Promise<CursorPage<EntityField>> {
  const limit = Math.min(input.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

  const conditions = [
    eq(entityFields.entityTypeId, entityTypeId),
    or(isNull(entityFields.tenantId), eq(entityFields.tenantId, tenantId)),
  ];

  if (input.cursor) {
    const decoded = decodeCursor(input.cursor);
    if (decoded) {
      const cursorCond = or(
        gt(entityFields.createdAt, decoded.createdAt),
        and(
          eq(entityFields.createdAt, decoded.createdAt),
          gt(entityFields.id, decoded.id),
        ),
      );
      if (cursorCond) conditions.push(cursorCond);
    }
  }

  const rows = await db
    .select()
    .from(entityFields)
    .where(and(...conditions))
    .orderBy(asc(entityFields.createdAt), asc(entityFields.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

  return { data: data.map(rowToEntityField), nextCursor };
}

export async function updateEntityField(
  db: DbOrTx,
  tenantId: string,
  entityTypeId: string,
  fieldId: string,
  input: UpdateEntityFieldInput,
): Promise<EntityField> {
  const [existing] = await db
    .select()
    .from(entityFields)
    .where(
      and(
        eq(entityFields.id, fieldId),
        eq(entityFields.entityTypeId, entityTypeId),
        or(isNull(entityFields.tenantId), eq(entityFields.tenantId, tenantId)),
      ),
    )
    .limit(1);

  if (!existing) throw new EntityError("FIELD_NOT_FOUND", { fieldId });

  const updates: Partial<typeof entityFields.$inferInsert> = {};
  if (input.label !== undefined) updates.label = input.label;
  if (input.config !== undefined) updates.config = input.config;
  if (input.isRequired !== undefined) updates.isRequired = input.isRequired;
  if (input.sortOrder !== undefined) updates.sortOrder = input.sortOrder;

  if (Object.keys(updates).length === 0) return rowToEntityField(existing);

  const [row] = await db
    .update(entityFields)
    .set(updates)
    .where(eq(entityFields.id, fieldId))
    .returning();

  if (!row) throw new EntityError("FIELD_NOT_FOUND", { fieldId });

  await invalidateSchemaCache(entityTypeId, tenantId);

  logger.info({ tenantId, entityTypeId, fieldId }, "Entity field updated");

  return rowToEntityField(row);
}

export async function deleteEntityField(
  db: DbOrTx,
  tenantId: string,
  entityTypeId: string,
  fieldId: string,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(entityFields)
    .where(
      and(
        eq(entityFields.id, fieldId),
        eq(entityFields.entityTypeId, entityTypeId),
        or(isNull(entityFields.tenantId), eq(entityFields.tenantId, tenantId)),
      ),
    )
    .limit(1);

  if (!existing) throw new EntityError("FIELD_NOT_FOUND", { fieldId });

  if (existing.isSystem) {
    throw new EntityError("SYSTEM_FIELD_IMMUTABLE", { fieldId });
  }

  // Existing instance.fields JSONB retains the orphaned key after deletion.
  // The key is ignored at validation time because the schema is rebuilt from
  // the remaining fields after cache invalidation below.
  await db.delete(entityFields).where(eq(entityFields.id, fieldId));

  await invalidateSchemaCache(entityTypeId, tenantId);

  logger.info({ tenantId, entityTypeId, fieldId }, "Entity field deleted");
}

function rowToEntityField(
  row: typeof entityFields.$inferSelect,
): EntityField {
  return {
    id: row.id,
    entityTypeId: row.entityTypeId,
    tenantId: row.tenantId ?? null,
    name: row.name,
    label: row.label,
    fieldType: row.fieldType as EntityField["fieldType"],
    config: (row.config as Record<string, unknown>) ?? {},
    isRequired: row.isRequired,
    isIndexed: row.isIndexed,
    isSystem: row.isSystem,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
  };
}
