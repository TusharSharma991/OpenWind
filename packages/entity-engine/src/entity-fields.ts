import { eq, and, asc, or, isNull } from "drizzle-orm";
import type { DbOrTx } from "@platform/db";
import { entityFields } from "@platform/db";
import { logger } from "@platform/logger";
import type { EntityField, FieldSensitivity } from "./types.js";
import { EntityError, ValidationError } from "./errors.js";
import { invalidateSchemaCache, isSafeRegex } from "./validation/index.js";

export type UpdateEntityFieldInput = {
  label?: string | undefined;
  config?: Record<string, unknown> | undefined;
  isRequired?: boolean | undefined;
  sortOrder?: number | undefined;
  sensitivity?: FieldSensitivity | undefined;
};

// Fields per entity type are bounded in size, so we return all sorted by
// sortOrder rather than paginating — this is the natural form-layout order.
export async function listEntityFields(
  db: DbOrTx,
  tenantId: string,
  entityTypeId: string,
): Promise<EntityField[]> {
  const rows = await db
    .select()
    .from(entityFields)
    .where(
      and(
        eq(entityFields.entityTypeId, entityTypeId),
        or(isNull(entityFields.tenantId), eq(entityFields.tenantId, tenantId)),
      ),
    )
    .orderBy(asc(entityFields.sortOrder), asc(entityFields.id));

  return rows.map(rowToEntityField);
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

  if (existing.isSystem) {
    throw new EntityError("SYSTEM_FIELD_IMMUTABLE", { fieldId });
  }

  // ReDoS guard: validate config.pattern only for text fields.
  // Checked here (not at the route layer) because the engine already holds
  // the existing field's type — the update schema does not carry fieldType.
  if (existing.fieldType === "text" && input.config !== undefined) {
    const pattern = input.config["pattern"];
    if (typeof pattern === "string" && pattern.length > 0) {
      const safe = await isSafeRegex(pattern);
      if (!safe) {
        throw new ValidationError([
          {
            field: "config.pattern",
            code: "INVALID_FORMAT",
            message:
              "Pattern is invalid or vulnerable to ReDoS — use a simpler regex",
          },
        ]);
      }
    }
  }

  const updates: Partial<typeof entityFields.$inferInsert> = {};
  if (input.label !== undefined) updates.label = input.label;
  if (input.config !== undefined) updates.config = input.config;
  if (input.isRequired !== undefined) updates.isRequired = input.isRequired;
  if (input.sortOrder !== undefined) updates.sortOrder = input.sortOrder;
  if (input.sensitivity !== undefined) updates.sensitivity = input.sensitivity;

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

function rowToEntityField(row: typeof entityFields.$inferSelect): EntityField {
  return {
    id: row.id,
    entityTypeId: row.entityTypeId,
    tenantId: row.tenantId ?? null,
    name: row.name,
    label: row.label,
    fieldType: row.fieldType as EntityField["fieldType"],
    // Drizzle types jsonb columns as `unknown` in select inference; the schema
    // declares this column NOT NULL with a default of `{}`, so it is always an
    // object at runtime.  The cast is safe but cannot be narrowed statically.
    config: row.config as Record<string, unknown>,
    isRequired: row.isRequired,
    isIndexed: row.isIndexed,
    isSystem: row.isSystem,
    sortOrder: row.sortOrder,
    // Drizzle types text columns as string; the CHECK constraint guarantees the
    // value is one of the four valid sensitivity levels.
    sensitivity: row.sensitivity as FieldSensitivity,
    createdAt: row.createdAt,
  };
}
