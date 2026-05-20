import { eq, and, asc, gt, isNull, or, inArray, sql } from "drizzle-orm";
import type { DbOrTx } from "@platform/db";
import { entityInstances, entityTypes, entityFields } from "@platform/db";
import { logger } from "@platform/logger";
import type {
  EntityInstance,
  EntityType,
  EntityField,
  CreateEntityInput,
  UpdateEntityInput,
  ListEntitiesInput,
  BulkCreateResult,
  BulkUpdateResult,
  BulkSetStateResult,
} from "./types.js";
import {
  encodeCursor,
  decodeCursor,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "./pagination.js";
import type { CursorPage } from "./pagination.js";
import { EntityError, ValidationError } from "./errors.js";
import type { FieldError } from "./errors.js";
import {
  getValidationSchema,
  invalidateSchemaCache,
  transformZodErrors,
  applyFormulaFields,
  validateEntityRefs,
} from "./validation/index.js";
import {
  resolveLookupFields,
  resolveLookupFieldsBatch,
} from "./lookup-resolver.js";

type EntityValidator = (
  fields: Record<string, unknown>,
  mode: "create" | "update",
) => FieldError[];

const crossFieldValidators = new Map<string, EntityValidator[]>();

export function registerValidator(
  entityTypeName: string,
  validator: EntityValidator,
): void {
  const existing = crossFieldValidators.get(entityTypeName) ?? [];
  crossFieldValidators.set(entityTypeName, [...existing, validator]);
}

export async function createEntity(
  db: DbOrTx,
  tenantId: string,
  input: CreateEntityInput,
): Promise<EntityInstance> {
  const entityType = await loadEntityType(db, input.entityTypeId);

  const schema = await getValidationSchema(
    db,
    input.entityTypeId,
    tenantId,
    "create",
  );
  const result = schema.safeParse(input.fields);

  if (!result.success) {
    throw new ValidationError(transformZodErrors(result.error));
  }

  const crossErrors = runCrossFieldValidators(
    entityType.name,
    result.data as Record<string, unknown>,
    "create",
  );
  if (crossErrors.length > 0) throw new ValidationError(crossErrors);

  const allFields = await loadEntityFields(db, input.entityTypeId, tenantId);

  // Cross-tenant entity_ref guard: ensure all referenced instances belong to
  // this tenant.  Runs after Zod (values are valid UUIDs) but before INSERT.
  const refErrors = await validateEntityRefs(
    db,
    tenantId,
    result.data as Record<string, unknown>,
    allFields,
  );
  if (refErrors.length > 0) throw new ValidationError(refErrors);

  const fieldsWithFormulas = await applyFormulaFields(
    allFields,
    result.data as Record<string, unknown>,
  );

  const [row] = await db
    .insert(entityInstances)
    .values({
      entityTypeId: input.entityTypeId,
      tenantId,
      workflowId: input.workflowId ?? null,
      currentState: "initial",
      fields: fieldsWithFormulas,
      createdBy: input.createdBy ?? null,
      assignedTo: input.assignedTo ?? null,
    })
    .returning();

  if (!row) throw new EntityError("ENTITY_NOT_FOUND");

  logger.info(
    {
      tenantId,
      entityTypeId: input.entityTypeId,
      instanceId: row.id,
      actorId: input.createdBy,
    },
    "Entity created",
  );

  return rowToInstance(row);
}

export async function getEntity(
  db: DbOrTx,
  tenantId: string,
  instanceId: string,
): Promise<EntityInstance> {
  const [row] = await db
    .select()
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.id, instanceId),
        eq(entityInstances.tenantId, tenantId),
        isNull(entityInstances.deletedAt),
      ),
    )
    .limit(1);

  if (!row) throw new EntityError("ENTITY_NOT_FOUND", { instanceId });

  // Recompute computed fields on read: lookups first, then formulas
  // (formulas may reference lookup-resolved values)
  const allFields = await loadEntityFields(db, row.entityTypeId, tenantId);
  const fieldsWithLookups = await resolveLookupFields(
    db,
    tenantId,
    row.id,
    allFields,
    row.fields as Record<string, unknown>,
  );
  const fieldsWithFormulas = await applyFormulaFields(
    allFields,
    fieldsWithLookups,
  );

  const instanceWithFormulas = rowToInstance(row);
  instanceWithFormulas.fields = fieldsWithFormulas;
  return instanceWithFormulas;
}

export async function updateEntity(
  db: DbOrTx,
  tenantId: string,
  instanceId: string,
  input: UpdateEntityInput,
): Promise<EntityInstance> {
  const [existing] = await db
    .select()
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.id, instanceId),
        eq(entityInstances.tenantId, tenantId),
        isNull(entityInstances.deletedAt),
      ),
    )
    .limit(1);

  if (!existing) throw new EntityError("ENTITY_NOT_FOUND", { instanceId });

  if (input.fields !== undefined) {
    // Step 1: validate only the provided fields (type/format checks)
    const partialSchema = await getValidationSchema(
      db,
      existing.entityTypeId,
      tenantId,
      "update",
    );
    const partialResult = partialSchema.safeParse(input.fields);
    if (!partialResult.success) {
      throw new ValidationError(transformZodErrors(partialResult.error));
    }

    // Step 2: merge and validate the full result (catches required-field clearing)
    const merged = {
      ...(existing.fields as Record<string, unknown>),
      ...(partialResult.data as Record<string, unknown>),
    };
    const fullSchema = await getValidationSchema(
      db,
      existing.entityTypeId,
      tenantId,
      "create",
    );
    const fullResult = fullSchema.safeParse(merged);
    if (!fullResult.success) {
      throw new ValidationError(transformZodErrors(fullResult.error));
    }

    const entityType = await loadEntityType(db, existing.entityTypeId);
    const crossErrors = runCrossFieldValidators(
      entityType.name,
      fullResult.data as Record<string, unknown>,
      "update",
    );
    if (crossErrors.length > 0) throw new ValidationError(crossErrors);

    const allFields = await loadEntityFields(
      db,
      existing.entityTypeId,
      tenantId,
    );

    // Cross-tenant entity_ref guard: validate only the fields being updated
    // (existing refs were already validated on create/previous update).
    // input.fields is narrowed to Record<string,unknown> by the enclosing if.
    const providedFields = input.fields;
    const updatedRefFields = allFields.filter(
      (f) => f.fieldType === "entity_ref" && f.name in providedFields,
    );
    if (updatedRefFields.length > 0) {
      const refErrors = await validateEntityRefs(
        db,
        tenantId,
        providedFields,
        updatedRefFields,
      );
      if (refErrors.length > 0) throw new ValidationError(refErrors);
    }

    const fieldsWithFormulas = await applyFormulaFields(
      allFields,
      fullResult.data as Record<string, unknown>,
    );

    const updates: Partial<typeof entityInstances.$inferInsert> = {
      fields: fieldsWithFormulas,
      updatedAt: new Date(),
    };
    if (input.assignedTo !== undefined) {
      updates.assignedTo = input.assignedTo;
    }

    const [row] = await db
      .update(entityInstances)
      .set(updates)
      .where(
        and(
          eq(entityInstances.id, instanceId),
          eq(entityInstances.tenantId, tenantId),
        ),
      )
      .returning();

    if (!row) throw new EntityError("ENTITY_NOT_FOUND", { instanceId });

    logger.info({ tenantId, instanceId }, "Entity updated");
    return rowToInstance(row);
  }

  // Fields not provided — only updating assignedTo
  if (input.assignedTo !== undefined) {
    const [row] = await db
      .update(entityInstances)
      .set({ assignedTo: input.assignedTo, updatedAt: new Date() })
      .where(
        and(
          eq(entityInstances.id, instanceId),
          eq(entityInstances.tenantId, tenantId),
        ),
      )
      .returning();

    if (!row) throw new EntityError("ENTITY_NOT_FOUND", { instanceId });
    return rowToInstance(row);
  }

  return rowToInstance(existing);
}

export async function deleteEntity(
  db: DbOrTx,
  tenantId: string,
  instanceId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: entityInstances.id })
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.id, instanceId),
        eq(entityInstances.tenantId, tenantId),
        isNull(entityInstances.deletedAt),
      ),
    )
    .limit(1);

  if (!row) throw new EntityError("ENTITY_NOT_FOUND", { instanceId });

  await db
    .update(entityInstances)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(entityInstances.id, instanceId),
        eq(entityInstances.tenantId, tenantId),
      ),
    );

  logger.info({ tenantId, instanceId }, "Entity soft-deleted");
}

export async function listEntities(
  db: DbOrTx,
  tenantId: string,
  input: ListEntitiesInput,
): Promise<CursorPage<EntityInstance>> {
  const limit = Math.min(input.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

  const conditions = [
    eq(entityInstances.tenantId, tenantId),
    eq(entityInstances.entityTypeId, input.entityTypeId),
  ];

  if (!input.includeDeleted) {
    conditions.push(isNull(entityInstances.deletedAt));
  }
  if (input.state !== undefined) {
    conditions.push(eq(entityInstances.currentState, input.state));
  }
  if (input.assignedTo !== undefined) {
    conditions.push(eq(entityInstances.assignedTo, input.assignedTo));
  }
  if (
    input.fieldFilters !== undefined &&
    Object.keys(input.fieldFilters).length > 0
  ) {
    conditions.push(
      sql`${entityInstances.fields} @> ${JSON.stringify(input.fieldFilters)}::jsonb`,
    );
  }
  if (input.cursor) {
    const decoded = decodeCursor(input.cursor);
    if (decoded) {
      const cursorCond = or(
        gt(entityInstances.createdAt, decoded.createdAt),
        and(
          eq(entityInstances.createdAt, decoded.createdAt),
          gt(entityInstances.id, decoded.id),
        ),
      );
      if (cursorCond) conditions.push(cursorCond);
    }
  }

  const rows = await db
    .select()
    .from(entityInstances)
    .where(and(...conditions))
    .orderBy(asc(entityInstances.createdAt), asc(entityInstances.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

  // Batch-resolve lookup fields (two queries per relationType, no N+1),
  // then apply formula fields with lookup values already present.
  const allFields = await loadEntityFields(db, input.entityTypeId, tenantId);
  const instances = data.map((r) => ({
    id: r.id,
    fields: r.fields as Record<string, unknown>,
  }));
  const resolvedMap = await resolveLookupFieldsBatch(
    db,
    tenantId,
    instances,
    allFields,
  );

  const resolvedData = await Promise.all(
    data.map(async (row) => {
      const withLookups =
        resolvedMap.get(row.id) ?? (row.fields as Record<string, unknown>);
      const withFormulas = await applyFormulaFields(allFields, withLookups);
      const instance = rowToInstance(row);
      instance.fields = withFormulas;
      return instance;
    }),
  );

  return { data: resolvedData, nextCursor };
}

export async function addEntityField(
  db: DbOrTx,
  tenantId: string,
  entityTypeId: string,
  field: Omit<EntityField, "id" | "tenantId">,
): Promise<EntityField> {
  const entityType = await loadEntityType(db, entityTypeId);

  if (!entityType.allowCustomFields && entityType.tenantId !== null) {
    throw new EntityError("CUSTOM_FIELDS_NOT_ALLOWED", { entityTypeId });
  }

  const [row] = await db
    .insert(entityFields)
    .values({
      entityTypeId,
      tenantId,
      name: field.name,
      label: field.label,
      fieldType: field.fieldType,
      config: field.config,
      isRequired: field.isRequired,
      isIndexed: field.isIndexed,
      isSystem: field.isSystem,
      sortOrder: field.sortOrder,
    })
    .returning();

  if (!row) throw new EntityError("ENTITY_TYPE_NOT_FOUND");

  await invalidateSchemaCache(entityTypeId, tenantId);

  return {
    ...row,
    config: row.config as Record<string, unknown>,
    fieldType: row.fieldType as EntityField["fieldType"],
  };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

async function loadEntityType(
  db: DbOrTx,
  entityTypeId: string,
): Promise<EntityType> {
  const [row] = await db
    .select()
    .from(entityTypes)
    .where(eq(entityTypes.id, entityTypeId))
    .limit(1);

  if (!row) throw new EntityError("ENTITY_TYPE_NOT_FOUND", { entityTypeId });

  return {
    ...row,
    tenantId: row.tenantId ?? null,
    moduleId: row.moduleId ?? null,
    icon: row.icon ?? null,
    allowCustomFields: row.allowCustomFields,
  };
}

async function loadEntityFields(
  db: DbOrTx,
  entityTypeId: string,
  tenantId: string,
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
    .orderBy(entityFields.sortOrder);

  return rows.map((r) => ({
    ...r,
    config: r.config as Record<string, unknown>,
    fieldType: r.fieldType as EntityField["fieldType"],
  }));
}

function runCrossFieldValidators(
  entityTypeName: string,
  fields: Record<string, unknown>,
  mode: "create" | "update",
): FieldError[] {
  const validators = crossFieldValidators.get(entityTypeName) ?? [];
  return validators.flatMap((v) => v(fields, mode));
}

function rowToInstance(
  row: typeof entityInstances.$inferSelect,
): EntityInstance {
  return {
    id: row.id,
    entityTypeId: row.entityTypeId,
    tenantId: row.tenantId,
    workflowId: row.workflowId ?? null,
    currentState: row.currentState,
    fields: row.fields as Record<string, unknown>,
    createdBy: row.createdBy ?? null,
    assignedTo: row.assignedTo ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt ?? null,
  };
}

// ── Bulk operations ───────────────────────────────────────────────────────────

export async function bulkCreateEntities(
  db: DbOrTx,
  tenantId: string,
  inputs: CreateEntityInput[],
): Promise<BulkCreateResult> {
  const errors: BulkCreateResult["errors"] = [];
  const toInsert: Array<typeof entityInstances.$inferInsert> = [];

  for (const [i, input] of inputs.entries()) {
    const schema = await getValidationSchema(
      db,
      input.entityTypeId,
      tenantId,
      "create",
    );
    const result = schema.safeParse(input.fields);

    if (!result.success) {
      errors.push({ index: i, fields: transformZodErrors(result.error) });
      continue;
    }

    const entityType = await loadEntityType(db, input.entityTypeId);
    const crossErrors = runCrossFieldValidators(
      entityType.name,
      result.data as Record<string, unknown>,
      "create",
    );
    if (crossErrors.length > 0) {
      errors.push({ index: i, fields: crossErrors });
      continue;
    }

    const allFields = await loadEntityFields(db, input.entityTypeId, tenantId);
    const fieldsWithFormulas = await applyFormulaFields(
      allFields,
      result.data as Record<string, unknown>,
    );

    toInsert.push({
      entityTypeId: input.entityTypeId,
      tenantId,
      workflowId: input.workflowId ?? null,
      currentState: "initial",
      fields: fieldsWithFormulas,
      createdBy: input.createdBy ?? null,
      assignedTo: input.assignedTo ?? null,
    });
  }

  if (toInsert.length === 0) {
    return { created: [], errors };
  }

  const rows = await db.insert(entityInstances).values(toInsert).returning();

  const created = rows.map(rowToInstance);

  logger.info(
    { tenantId, count: created.length, errorCount: errors.length },
    "Bulk create completed",
  );

  return { created, errors };
}

export async function bulkUpdateEntities(
  db: DbOrTx,
  tenantId: string,
  updates: Array<{ id: string; input: UpdateEntityInput }>,
): Promise<BulkUpdateResult> {
  const updated: EntityInstance[] = [];
  const errors: BulkUpdateResult["errors"] = [];

  await Promise.all(
    updates.map(async ({ id, input }, i) => {
      const [existing] = await db
        .select()
        .from(entityInstances)
        .where(
          and(
            eq(entityInstances.id, id),
            eq(entityInstances.tenantId, tenantId),
            isNull(entityInstances.deletedAt),
          ),
        )
        .limit(1);

      if (!existing) {
        errors.push({ index: i, id, code: "ENTITY_NOT_FOUND" });
        return;
      }

      if (input.fields !== undefined) {
        const partialSchema = await getValidationSchema(
          db,
          existing.entityTypeId,
          tenantId,
          "update",
        );
        const partialResult = partialSchema.safeParse(input.fields);
        if (!partialResult.success) {
          errors.push({
            index: i,
            id,
            code: "VALIDATION_ERROR",
            fields: transformZodErrors(partialResult.error),
          });
          return;
        }

        const merged = {
          ...(existing.fields as Record<string, unknown>),
          ...(partialResult.data as Record<string, unknown>),
        };
        const fullSchema = await getValidationSchema(
          db,
          existing.entityTypeId,
          tenantId,
          "create",
        );
        const fullResult = fullSchema.safeParse(merged);
        if (!fullResult.success) {
          errors.push({
            index: i,
            id,
            code: "VALIDATION_ERROR",
            fields: transformZodErrors(fullResult.error),
          });
          return;
        }

        const entityType = await loadEntityType(db, existing.entityTypeId);
        const crossErrors = runCrossFieldValidators(
          entityType.name,
          fullResult.data as Record<string, unknown>,
          "update",
        );
        if (crossErrors.length > 0) {
          errors.push({
            index: i,
            id,
            code: "VALIDATION_ERROR",
            fields: crossErrors,
          });
          return;
        }

        const allFields = await loadEntityFields(
          db,
          existing.entityTypeId,
          tenantId,
        );
        const fieldsWithFormulas = await applyFormulaFields(
          allFields,
          fullResult.data as Record<string, unknown>,
        );

        const updateValues: Partial<typeof entityInstances.$inferInsert> = {
          fields: fieldsWithFormulas,
          updatedAt: new Date(),
        };
        if (input.assignedTo !== undefined) {
          updateValues.assignedTo = input.assignedTo;
        }

        const [row] = await db
          .update(entityInstances)
          .set(updateValues)
          .where(
            and(
              eq(entityInstances.id, id),
              eq(entityInstances.tenantId, tenantId),
            ),
          )
          .returning();

        if (row) updated.push(rowToInstance(row));
      } else if (input.assignedTo !== undefined) {
        const [row] = await db
          .update(entityInstances)
          .set({ assignedTo: input.assignedTo, updatedAt: new Date() })
          .where(
            and(
              eq(entityInstances.id, id),
              eq(entityInstances.tenantId, tenantId),
            ),
          )
          .returning();

        if (row) updated.push(rowToInstance(row));
      } else {
        updated.push(rowToInstance(existing));
      }
    }),
  );

  logger.info(
    { tenantId, count: updated.length, errorCount: errors.length },
    "Bulk update completed",
  );

  return { updated, errors };
}

export async function bulkSetState(
  db: DbOrTx,
  tenantId: string,
  items: Array<{ id: string; state: string }>,
): Promise<BulkSetStateResult> {
  if (items.length === 0) return { updatedIds: [], errors: [] };

  const ids = items.map((item) => item.id);

  // Load all matching instances in one query to verify tenant ownership
  const existing = await db
    .select({ id: entityInstances.id })
    .from(entityInstances)
    .where(
      and(
        inArray(entityInstances.id, ids),
        eq(entityInstances.tenantId, tenantId),
        isNull(entityInstances.deletedAt),
      ),
    );

  const foundIds = new Set(existing.map((r) => r.id));

  const errors: BulkSetStateResult["errors"] = [];
  const validItems: Array<{ id: string; state: string }> = [];

  for (const [i, item] of items.entries()) {
    if (!foundIds.has(item.id)) {
      errors.push({ index: i, id: item.id, code: "ENTITY_NOT_FOUND" });
    } else {
      validItems.push(item);
    }
  }

  if (validItems.length === 0) return { updatedIds: [], errors };

  // Group by target state — one UPDATE per unique state value
  const byState = new Map<string, string[]>();
  for (const item of validItems) {
    const bucket = byState.get(item.state) ?? [];
    bucket.push(item.id);
    byState.set(item.state, bucket);
  }

  const updatedIds: string[] = [];

  for (const [state, stateIds] of byState) {
    const rows = await db
      .update(entityInstances)
      .set({ currentState: state, updatedAt: new Date() })
      .where(
        and(
          inArray(entityInstances.id, stateIds),
          eq(entityInstances.tenantId, tenantId),
        ),
      )
      .returning({ id: entityInstances.id });

    updatedIds.push(...rows.map((r) => r.id));
  }

  logger.info(
    { tenantId, count: updatedIds.length, errorCount: errors.length },
    "Bulk state-set completed",
  );

  return { updatedIds, errors };
}

export async function setEntityState(
  db: DbOrTx,
  tenantId: string,
  instanceId: string,
  state: string,
): Promise<EntityInstance> {
  const [existing] = await db
    .select({ id: entityInstances.id })
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.id, instanceId),
        eq(entityInstances.tenantId, tenantId),
        isNull(entityInstances.deletedAt),
      ),
    )
    .limit(1);

  if (!existing) throw new EntityError("ENTITY_NOT_FOUND", { instanceId });

  const [row] = await db
    .update(entityInstances)
    .set({ currentState: state, updatedAt: new Date() })
    .where(
      and(
        eq(entityInstances.id, instanceId),
        eq(entityInstances.tenantId, tenantId),
      ),
    )
    .returning();

  if (!row) throw new EntityError("ENTITY_NOT_FOUND", { instanceId });

  logger.info({ tenantId, instanceId, state }, "Entity state set");
  return rowToInstance(row);
}
