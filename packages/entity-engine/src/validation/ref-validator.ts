/**
 * ref-validator.ts
 *
 * Cross-tenant entity_ref validation.
 *
 * When a field has type "entity_ref" its value is a UUID referencing another
 * entity instance.  Without this check a user could submit the UUID of an
 * entity that belongs to a different tenant — bypassing row-level security at
 * the application layer (RLS still protects the database, but a misleading
 * 422 is better than a silent reference to an invisible object).
 *
 * This validator is called after Zod schema validation passes (so values are
 * already confirmed to be UUIDs) and before the INSERT/UPDATE is issued.
 */

import { eq, and, inArray } from "drizzle-orm";
import type { DbOrTx } from "@platform/db";
import { entityInstances, tenantUsers } from "@platform/db";
import type { EntityField } from "../types.js";
import type { FieldError } from "../errors.js";

/**
 * Validates that every entity_ref value in `fields` references an instance
 * that belongs to `tenantId`.
 *
 * @param db           — db client or transaction
 * @param tenantId     — the requesting tenant
 * @param fields       — the field values to validate (may be partial on update)
 * @param entityFields — the full field definitions for the entity type
 * @returns            — array of FieldErrors; empty means all refs are valid
 */
export async function validateEntityRefs(
  db: DbOrTx,
  tenantId: string,
  fields: Record<string, unknown>,
  entityFields: EntityField[],
): Promise<FieldError[]> {
  // Collect (fieldName → refId) pairs for all entity_ref fields that have a
  // non-null value in the submitted fields.
  const refFields = entityFields.filter((f) => f.fieldType === "entity_ref");

  type RefEntry = { fieldName: string; refId: string };
  const refs: RefEntry[] = [];

  for (const field of refFields) {
    const value = fields[field.name];
    if (typeof value === "string" && value.length > 0) {
      refs.push({ fieldName: field.name, refId: value });
    }
  }

  if (refs.length === 0) return [];

  // Batch lookup: find all referenced instances that belong to this tenant.
  const refIds = refs.map((r) => r.refId);
  const validRows = await db
    .select({ id: entityInstances.id })
    .from(entityInstances)
    .where(
      and(
        inArray(entityInstances.id, refIds),
        eq(entityInstances.tenantId, tenantId),
      ),
    );

  const validIdSet = new Set(validRows.map((r) => r.id));

  const errors: FieldError[] = [];
  for (const { fieldName, refId } of refs) {
    if (!validIdSet.has(refId)) {
      errors.push({
        field: fieldName,
        code: "INVALID_REFERENCE",
        message: `Referenced entity does not exist or is not accessible`,
        meta: { refId },
      });
    }
  }

  return errors;
}

/**
 * Validates that every user_ref value in `fields` references a user who has
 * authenticated into `tenantId` (i.e. exists in the tenant_users shadow table).
 *
 * The tenant_users table is populated by the auth middleware on every
 * successful JWT verification.  A user UUID that has never authenticated into
 * this tenant will fail validation even if it exists in Zitadel — cross-tenant
 * user references are treated as non-existent at the application layer.
 *
 * @param db           — db client or transaction
 * @param tenantId     — the requesting tenant
 * @param fields       — the field values to validate (may be partial on update)
 * @param entityFields — the full field definitions for the entity type
 * @returns            — array of FieldErrors; empty means all refs are valid
 */
export async function validateUserRefs(
  db: DbOrTx,
  tenantId: string,
  fields: Record<string, unknown>,
  entityFields: EntityField[],
): Promise<FieldError[]> {
  const userRefFields = entityFields.filter((f) => f.fieldType === "user_ref");

  type RefEntry = { fieldName: string; userId: string };
  const refs: RefEntry[] = [];

  for (const field of userRefFields) {
    const value = fields[field.name];
    if (typeof value === "string" && value.length > 0) {
      refs.push({ fieldName: field.name, userId: value });
    }
  }

  if (refs.length === 0) return [];

  // Batch lookup: find all referenced user IDs that belong to this tenant.
  const userIds = refs.map((r) => r.userId);
  const validRows = await db
    .select({ userId: tenantUsers.userId })
    .from(tenantUsers)
    .where(
      and(
        inArray(tenantUsers.userId, userIds),
        eq(tenantUsers.tenantId, tenantId),
      ),
    );

  const validUserIdSet = new Set(validRows.map((r) => r.userId));

  const errors: FieldError[] = [];
  for (const { fieldName, userId } of refs) {
    if (!validUserIdSet.has(userId)) {
      errors.push({
        field: fieldName,
        code: "INVALID_REFERENCE",
        message: `Referenced user does not exist or is not accessible`,
        meta: { userId },
      });
    }
  }

  return errors;
}
