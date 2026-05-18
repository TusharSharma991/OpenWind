import { eq, and, or, isNull, count } from "drizzle-orm";
import type { DbOrTx } from "@platform/db";
import { entityTypes, entityInstances } from "@platform/db";
import { logger } from "@platform/logger";
import type { EntityType } from "./types.js";
import { EntityError } from "./errors.js";

export type CreateEntityTypeInput = {
  name: string;
  plural: string;
  icon?: string;
  moduleId?: string;
  allowCustomFields?: boolean;
};

export type UpdateEntityTypeInput = {
  name?: string;
  plural?: string;
  icon?: string | null;
  allowCustomFields?: boolean;
};

export type ListEntityTypesInput = {
  moduleId?: string;
};

export async function createEntityType(
  db: DbOrTx,
  tenantId: string | null,
  input: CreateEntityTypeInput,
): Promise<EntityType> {
  const [row] = await db
    .insert(entityTypes)
    .values({
      tenantId,
      name: input.name,
      plural: input.plural,
      icon: input.icon ?? null,
      moduleId: input.moduleId ?? null,
      allowCustomFields: input.allowCustomFields ?? true,
    })
    .returning();

  if (!row) throw new EntityError("ENTITY_TYPE_NOT_FOUND");

  logger.info(
    { tenantId, entityTypeId: row.id, name: row.name },
    "Entity type created",
  );

  return rowToEntityType(row);
}

export async function getEntityType(
  db: DbOrTx,
  tenantId: string,
  entityTypeId: string,
): Promise<EntityType> {
  const [row] = await db
    .select()
    .from(entityTypes)
    .where(
      and(
        eq(entityTypes.id, entityTypeId),
        or(isNull(entityTypes.tenantId), eq(entityTypes.tenantId, tenantId)),
      ),
    )
    .limit(1);

  if (!row) throw new EntityError("ENTITY_TYPE_NOT_FOUND", { entityTypeId });

  return rowToEntityType(row);
}

export async function listEntityTypes(
  db: DbOrTx,
  tenantId: string,
  input: ListEntityTypesInput = {},
): Promise<EntityType[]> {
  const conditions = [
    or(isNull(entityTypes.tenantId), eq(entityTypes.tenantId, tenantId)),
  ];

  if (input.moduleId !== undefined) {
    conditions.push(eq(entityTypes.moduleId, input.moduleId));
  }

  const rows = await db
    .select()
    .from(entityTypes)
    .where(and(...conditions))
    .orderBy(entityTypes.name);

  return rows.map(rowToEntityType);
}

export async function updateEntityType(
  db: DbOrTx,
  tenantId: string,
  entityTypeId: string,
  input: UpdateEntityTypeInput,
): Promise<EntityType> {
  const [existing] = await db
    .select()
    .from(entityTypes)
    .where(
      and(
        eq(entityTypes.id, entityTypeId),
        or(isNull(entityTypes.tenantId), eq(entityTypes.tenantId, tenantId)),
      ),
    )
    .limit(1);

  if (!existing) throw new EntityError("ENTITY_TYPE_NOT_FOUND", { entityTypeId });

  const updates: Partial<typeof entityTypes.$inferInsert> = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.plural !== undefined) updates.plural = input.plural;
  if ("icon" in input) updates.icon = input.icon ?? null;
  if (input.allowCustomFields !== undefined) {
    updates.allowCustomFields = input.allowCustomFields;
  }

  if (Object.keys(updates).length === 0) return rowToEntityType(existing);

  const [row] = await db
    .update(entityTypes)
    .set(updates)
    .where(eq(entityTypes.id, entityTypeId))
    .returning();

  if (!row) throw new EntityError("ENTITY_TYPE_NOT_FOUND", { entityTypeId });

  logger.info({ tenantId, entityTypeId }, "Entity type updated");

  return rowToEntityType(row);
}

export async function deleteEntityType(
  db: DbOrTx,
  tenantId: string,
  entityTypeId: string,
): Promise<void> {
  const [existing] = await db
    .select({ id: entityTypes.id })
    .from(entityTypes)
    .where(
      and(
        eq(entityTypes.id, entityTypeId),
        or(isNull(entityTypes.tenantId), eq(entityTypes.tenantId, tenantId)),
      ),
    )
    .limit(1);

  if (!existing) throw new EntityError("ENTITY_TYPE_NOT_FOUND", { entityTypeId });

  const [instanceCount] = await db
    .select({ count: count() })
    .from(entityInstances)
    .where(eq(entityInstances.entityTypeId, entityTypeId));

  if (instanceCount && instanceCount.count > 0) {
    throw new EntityError("ENTITY_TYPE_HAS_INSTANCES", {
      entityTypeId,
      count: instanceCount.count,
    });
  }

  await db.delete(entityTypes).where(eq(entityTypes.id, entityTypeId));

  logger.info({ tenantId, entityTypeId }, "Entity type deleted");
}

function rowToEntityType(row: typeof entityTypes.$inferSelect): EntityType {
  return {
    id: row.id,
    tenantId: row.tenantId ?? null,
    name: row.name,
    plural: row.plural,
    icon: row.icon ?? null,
    moduleId: row.moduleId ?? null,
    allowCustomFields: row.allowCustomFields,
    createdAt: row.createdAt,
  };
}
