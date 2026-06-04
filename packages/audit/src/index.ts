/**
 * @platform/audit
 *
 * Append-only audit log for all entity mutations.
 * Writes to `admin_audit_log` in the same DB transaction as the mutation.
 *
 * PII invariant: before_snapshot and after_snapshot are redacted using the
 * same `redactMetadata` + `buildSensitivityMap` logic as the workflow engine.
 * This ensures that sensitive field values are never stored verbatim in the
 * audit log, even if they appear in entity field values.
 *
 * Usage:
 *   await writeAuditEntry(tx, {
 *     tenantId, actorId, actorType: 'user',
 *     resourceType: 'ticket', resourceId: instance.id,
 *     action: 'created',
 *     afterSnapshot: instance.fields,
 *     entityFields: allFields,  // for redaction
 *   });
 *
 * Call this inside the same transaction as the entity mutation.
 */

import type { DbOrTx } from "@platform/db";
import { adminAuditLog } from "@platform/db";
import { logger } from "@platform/logger";
import {
  redactMetadata,
  buildSensitivityMap,
  type FieldSensitivity,
} from "@platform/workflow-engine";

export type AuditActorType = "user" | "api_key" | "system";
export type AuditAction =
  | "created"
  | "updated"
  | "deleted"
  | "transitioned"
  | "restored";

export type AuditEntryInput = {
  tenantId: string;
  actorId: string;
  actorType: AuditActorType;
  resourceType: string;
  resourceId: string;
  action: AuditAction;
  /** Raw field values before mutation — will be redacted for pii/financial fields */
  beforeSnapshot?: Record<string, unknown> | null | undefined;
  /** Raw field values after mutation — will be redacted for pii/financial fields */
  afterSnapshot?: Record<string, unknown> | null | undefined;
  /** Additional context (e.g. transition name, bulk batch id) */
  metadata?: Record<string, unknown> | null | undefined;
  /**
   * Field definitions for the mutated entity type.
   * Used to build the sensitivity map for redaction.
   * If omitted, no redaction is applied (safe fallback for non-entity audits).
   */
  entityFields?: ReadonlyArray<{
    name: string;
    sensitivity: FieldSensitivity;
  }>;
};

/**
 * Write an audit entry in the same transaction as the mutation it describes.
 *
 * Redacts pii/financial field values from before_snapshot and after_snapshot
 * before persisting. Field names are always retained.
 */
export async function writeAuditEntry(
  db: DbOrTx,
  input: AuditEntryInput,
): Promise<void> {
  const sensitivityMap = input.entityFields
    ? buildSensitivityMap(input.entityFields)
    : new Map<string, FieldSensitivity>();

  const beforeSnapshot =
    input.beforeSnapshot !== null && input.beforeSnapshot !== undefined
      ? redactMetadata(input.beforeSnapshot, sensitivityMap)
      : null;

  const afterSnapshot =
    input.afterSnapshot !== null && input.afterSnapshot !== undefined
      ? redactMetadata(input.afterSnapshot, sensitivityMap)
      : null;

  await db.insert(adminAuditLog).values({
    tenantId: input.tenantId,
    actorId: input.actorId,
    actorType: input.actorType,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    action: input.action,
    beforeSnapshot: beforeSnapshot,
    afterSnapshot: afterSnapshot,
    metadata: input.metadata ?? null,
  });

  logger.info(
    {
      tenantId: input.tenantId,
      actorId: input.actorId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      action: input.action,
    },
    "audit: entry written",
  );
}
