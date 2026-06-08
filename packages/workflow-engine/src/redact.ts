/**
 * redact.ts
 *
 * Pure function for redacting PII/financial field values from
 * workflow_events.metadata before they are written to the database.
 *
 * Contract:
 *  - Field VALUES for `pii` and `financial` sensitivity levels are replaced
 *    with the string "[REDACTED]"
 *  - Field NAMES (keys) are always preserved — consumers must know which
 *    fields exist even when values are hidden
 *  - `public` and `internal` field values pass through unmodified
 *  - Keys that do not correspond to any known field pass through unmodified
 *    (e.g. `comment`, `triggeredBy`, `idempotencyKey`)
 *  - Only top-level metadata keys are checked — nested objects within a
 *    field value are NOT traversed; the entire value is replaced as a unit
 *  - The function is pure: it never mutates the input and always returns a
 *    new object
 */

import type { FieldSensitivity } from "@platform/entity-engine";

/**
 * Replace PII/financial field values in a metadata object with "[REDACTED]".
 *
 * @param metadata         - raw metadata record from a transition request
 * @param sensitivityMap   - field name → sensitivity level for the entity type
 * @returns                - a new object with sensitive values replaced
 */
export function redactMetadata(
  metadata: Record<string, unknown>,
  sensitivityMap: Map<string, FieldSensitivity>,
): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    const sensitivity = sensitivityMap.get(key);
    if (sensitivity === "pii" || sensitivity === "financial") {
      redacted[key] = "[REDACTED]";
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}

/**
 * Build a sensitivity map from a list of entity fields for use with
 * `redactMetadata`. Only includes fields where sensitivity is
 * `pii` or `financial` — the hot path only needs to check those.
 *
 * Returns a Map from field name → sensitivity level.
 */
export function buildSensitivityMap(
  fields: ReadonlyArray<{ name: string; sensitivity: FieldSensitivity }>,
): Map<string, FieldSensitivity> {
  const map = new Map<string, FieldSensitivity>();
  for (const field of fields) {
    if (field.sensitivity === "pii" || field.sensitivity === "financial") {
      map.set(field.name, field.sensitivity);
    }
  }
  return map;
}
