import { Hono } from "hono";
import { logger as honoLogger } from "hono/logger";
import { env } from "@platform/config";
import { correlationId } from "./middleware/correlation-id.js";
import { handleError } from "./middleware/error-handler.js";
import { rateLimit } from "./middleware/rate-limit.js";
import { entityTypesRouter } from "./routes/entity-types/index.js";
import { entitiesRouter } from "./routes/entities/index.js";
import { workflowsRouter } from "./routes/workflows/index.js";
import { automationRulesRouter } from "./routes/automation-rules/index.js";
import { apiKeysRouter } from "./routes/api-keys/index.js";
import { filesRouter } from "./routes/files/index.js";
import { adminRouter } from "./routes/admin/index.js";
import { preferencesRouter } from "./routes/preferences/index.js";
import { openApiSpec } from "./openapi.js";

export function createApp(): Hono {
  const app = new Hono();

  // Middleware order matters:
  // 1. Correlation ID — must be first so all downstream logs carry the request ID
  app.use("*", correlationId());
  // 2. Hono request logger
  app.use("*", honoLogger());
  // 3. Rate limiter — before auth so unauthenticated flood is blocked cheaply
  app.use("*", rateLimit());
  // 4. Error handler — app.onError is the correct Hono v4 API for route errors
  app.onError(handleError);

  app.get("/health", (c) => c.json({ status: "ok", env: env.NODE_ENV }));

  // OpenAPI spec — unauthenticated, served from generated static object
  app.get("/openapi.json", (c) => c.json(openApiSpec));

  app.route("/entity-types", entityTypesRouter);
  app.route("/entities", entitiesRouter);
  app.route("/workflows", workflowsRouter);
  app.route("/automation-rules", automationRulesRouter);
  app.route("/api-keys", apiKeysRouter);
  app.route("/files", filesRouter);
  app.route("/admin", adminRouter);
  app.route("/preferences", preferencesRouter);

  return app;
}
