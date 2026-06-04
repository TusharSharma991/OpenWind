import { serve } from "@hono/node-server";
import { logger } from "@platform/logger";
import { createApp } from "./app.js";
import { ModuleService } from "./services/module-service.js";

const app = createApp();
const port = 3000;

logger.info({ port }, "API server starting");

serve({ fetch: app.fetch, port }, () => {
  logger.info({ port }, "API server listening");
  ModuleService.seedRegistry().catch((err: unknown) => {
    logger.error({ err }, "Failed to seed modules registry on startup");
  });
});
