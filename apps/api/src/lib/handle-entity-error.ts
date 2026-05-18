import type { Context } from "hono";
import { EntityError, ValidationError } from "@platform/entity-engine";
import { logger } from "@platform/logger";

export function handleEntityError(c: Context, err: unknown): Response {
  if (err instanceof ValidationError) {
    return c.json(
      { error: "VALIDATION_ERROR", message: "Validation failed", fields: err.fields },
      422,
    ) as Response;
  }

  if (err instanceof EntityError) {
    switch (err.code) {
      case "ENTITY_TYPE_NOT_FOUND":
      case "ENTITY_NOT_FOUND":
      case "FIELD_NOT_FOUND":
      case "RELATION_NOT_FOUND":
      case "RELATION_TARGET_NOT_FOUND":
        return c.json({ error: err.code, message: "Not found" }, 404) as Response;
      case "ENTITY_TYPE_HAS_INSTANCES":
        return c.json(
          { error: err.code, message: "Cannot delete: entity type has existing instances" },
          409,
        ) as Response;
      case "SYSTEM_FIELD_IMMUTABLE":
        return c.json(
          { error: err.code, message: "System fields cannot be deleted" },
          422,
        ) as Response;
      case "CUSTOM_FIELDS_NOT_ALLOWED":
        return c.json({ error: err.code, message: "Custom fields are not allowed on this type" }, 422) as Response;
      default:
        break;
    }
  }

  logger.error({ err }, "Unhandled error in entity route");
  return c.json({ error: "INTERNAL_ERROR", message: "An unexpected error occurred" }, 500) as Response;
}
