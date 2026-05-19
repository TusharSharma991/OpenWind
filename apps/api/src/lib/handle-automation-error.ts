import type { Context } from "hono";
import { AutomationError } from "@platform/automation-engine";
import { logger } from "@platform/logger";

export function handleAutomationError(c: Context, err: unknown): Response {
  if (err instanceof AutomationError) {
    switch (err.code) {
      case "RULE_NOT_FOUND":
        return c.json({ error: err.code, message: "Not found" }, 404) as Response;
      default:
        break;
    }
  }

  logger.error({ err }, "Unhandled error in automation-rules route");
  return c.json(
    { error: "INTERNAL_ERROR", message: "An unexpected error occurred" },
    500,
  ) as Response;
}
