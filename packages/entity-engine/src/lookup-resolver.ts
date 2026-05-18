import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DbOrTx } from "@platform/db";
import { entityRelations, entityInstances } from "@platform/db";
import { logger } from "@platform/logger";

interface FieldSpec {
  name: string;
  fieldType: string;
  config: Record<string, unknown>;
}

interface ParsedLookup {
  fieldName: string;
  relationType: string;
  targetField: string;
}

function parseLookupFields(fields: FieldSpec[]): ParsedLookup[] {
  const result: ParsedLookup[] = [];

  for (const field of fields) {
    if (field.fieldType !== "lookup") continue;

    const relationType = field.config["relationType"];
    const targetField = field.config["targetField"];

    if (typeof relationType !== "string" || typeof targetField !== "string") {
      logger.warn(
        { fieldName: field.name },
        "Lookup field has invalid config — skipping",
      );
      continue;
    }

    result.push({ fieldName: field.name, relationType, targetField });
  }

  return result;
}

/**
 * Resolves lookup fields for a single entity instance.
 * Max depth: 1 — lookup chains are not followed.
 * Tenant boundary enforced: cross-tenant targets resolve to null.
 */
export async function resolveLookupFields(
  db: DbOrTx,
  tenantId: string,
  instanceId: string,
  fields: FieldSpec[],
  values: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const lookups = parseLookupFields(fields);
  if (lookups.length === 0) return values;

  const result = { ...values };

  const relationTypes = [...new Set(lookups.map((l) => l.relationType))];

  for (const relationType of relationTypes) {
    const [relation] = await db
      .select({ toInstanceId: entityRelations.toInstanceId })
      .from(entityRelations)
      .where(
        and(
          eq(entityRelations.fromInstanceId, instanceId),
          eq(entityRelations.tenantId, tenantId),
          eq(entityRelations.relationType, relationType),
        ),
      )
      .limit(1);

    if (!relation) continue;

    const [target] = await db
      .select({ fields: entityInstances.fields })
      .from(entityInstances)
      .where(
        and(
          eq(entityInstances.id, relation.toInstanceId),
          eq(entityInstances.tenantId, tenantId),
          isNull(entityInstances.deletedAt),
        ),
      )
      .limit(1);

    if (!target) continue;

    const targetFields = target.fields as Record<string, unknown>;

    for (const lookup of lookups) {
      if (lookup.relationType !== relationType) continue;
      result[lookup.fieldName] = targetFields[lookup.targetField] ?? null;
    }
  }

  return result;
}

/**
 * Resolves lookup fields for a batch of entity instances.
 * Uses two batched queries per relationType (no N+1).
 * Tenant boundary enforced: cross-tenant targets resolve to null.
 */
export async function resolveLookupFieldsBatch(
  db: DbOrTx,
  tenantId: string,
  instances: ReadonlyArray<{ id: string; fields: Record<string, unknown> }>,
  fields: FieldSpec[],
): Promise<Map<string, Record<string, unknown>>> {
  const resultMap = new Map<string, Record<string, unknown>>(
    instances.map((i) => [i.id, { ...i.fields }]),
  );

  const lookups = parseLookupFields(fields);
  if (lookups.length === 0) return resultMap;
  if (instances.length === 0) return resultMap;

  const instanceIds = instances.map((i) => i.id);
  const relationTypes = [...new Set(lookups.map((l) => l.relationType))];

  for (const relationType of relationTypes) {
    const relations = await db
      .select({
        fromInstanceId: entityRelations.fromInstanceId,
        toInstanceId: entityRelations.toInstanceId,
      })
      .from(entityRelations)
      .where(
        and(
          inArray(entityRelations.fromInstanceId, instanceIds),
          eq(entityRelations.tenantId, tenantId),
          eq(entityRelations.relationType, relationType),
        ),
      );

    if (relations.length === 0) continue;

    // Keep first relation per fromInstanceId (depth = 1, no chaining)
    const fromToMap = new Map<string, string>();
    for (const rel of relations) {
      if (!fromToMap.has(rel.fromInstanceId)) {
        fromToMap.set(rel.fromInstanceId, rel.toInstanceId);
      }
    }

    const toIds = [...new Set(fromToMap.values())];

    const targets = await db
      .select({ id: entityInstances.id, fields: entityInstances.fields })
      .from(entityInstances)
      .where(
        and(
          inArray(entityInstances.id, toIds),
          eq(entityInstances.tenantId, tenantId),
          isNull(entityInstances.deletedAt),
        ),
      );

    const targetFieldsById = new Map(
      targets.map((t) => [t.id, t.fields as Record<string, unknown>]),
    );

    const lookupsForType = lookups.filter(
      (l) => l.relationType === relationType,
    );

    for (const [fromId, toId] of fromToMap) {
      const targetFields = targetFieldsById.get(toId);
      if (!targetFields) continue;

      const instanceValues = resultMap.get(fromId);
      if (!instanceValues) continue;

      for (const lookup of lookupsForType) {
        instanceValues[lookup.fieldName] =
          targetFields[lookup.targetField] ?? null;
      }
    }
  }

  return resultMap;
}
