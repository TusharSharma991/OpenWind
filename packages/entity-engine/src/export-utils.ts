import type { EntityField, EntityInstance } from "./types.js";

/**
 * Serialize one entity instance into an ordered string array for CSV/xlsx/PDF
 * export. Column order: id, state, createdAt, updatedAt, ...dynamic fields.
 */
export function buildExportRow(
  instance: EntityInstance,
  fields: EntityField[],
): string[] {
  return [
    instance.id,
    instance.currentState,
    instance.createdAt.toISOString(),
    instance.updatedAt.toISOString(),
    ...fields.map((f) => {
      const v = instance.fields[f.name];
      if (v === null || v === undefined) return "";
      if (typeof v === "object") return JSON.stringify(v);
      return String(v);
    }),
  ];
}
