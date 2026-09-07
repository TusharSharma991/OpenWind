export const FIELD_TYPES = [
  "text",
  "longtext",
  "number",
  "currency",
  "date",
  "datetime",
  "boolean",
  "enum",
  // "select" is an alias for "enum" -- kept as its own recognized type
  // (rather than requiring every caller to normalize it away) because it's
  // already load-bearing seed data: modules/helpdesk/seed/001_entity_types.sql
  // and apps/admin-ui's own field-type UI (entity-types/detail.tsx) both use
  // "select" as the real, on-disk value for single-choice fields -- adding
  // "enum" support alone would leave those fields silently unvalidated
  // (schema-builder.ts's buildFieldSchema falls through to z.unknown() for
  // any unrecognized type, which also silently defeats is_required). See the
  // week-log entry for the bug this was found from.
  "select",
  "multi_enum",
  "user_ref",
  "entity_ref",
  "file",
  "files",
  "formula",
  "lookup",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];
