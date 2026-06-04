import { Hono } from "hono";
import { cors } from "hono/cors";
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
import { modulesRouter } from "./routes/modules/index.js";
import { viewConfigsRouter } from "./routes/view-configs/index.js";

export function createApp(): Hono {
  const app = new Hono();

  // Middleware order matters:
  // 1. CORS — before everything so preflight OPTIONS requests are handled immediately
  app.use(
    "*",
    cors({
      origin: (origin) =>
        origin.startsWith("http://localhost:")
          ? origin
          : "http://localhost:3001",
      allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-Correlation-ID"],
      exposeHeaders: ["X-Correlation-ID"],
      credentials: true,
    }),
  );
  // 2. Correlation ID — must be early so all downstream logs carry the request ID
  app.use("*", correlationId());
  // 2. Hono request logger
  app.use("*", honoLogger());
  // 3. Rate limiter — before auth so unauthenticated flood is blocked cheaply
  app.use("*", rateLimit());
  // 4. Error handler — app.onError is the correct Hono v4 API for route errors
  app.onError(handleError);

  app.get("/health", (c) => c.json({ status: "ok", env: env.NODE_ENV }));

  app.route("/entity-types", entityTypesRouter);
  app.route("/entities", entitiesRouter);
  app.route("/workflows", workflowsRouter);
  app.route("/automation-rules", automationRulesRouter);
  app.route("/api-keys", apiKeysRouter);
  app.route("/modules", modulesRouter);
  app.route("/admin/view-configs", viewConfigsRouter);

  return app;
}
