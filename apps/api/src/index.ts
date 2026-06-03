import { serve } from "@hono/node-server";
import { logger } from "@platform/logger";
import { createApp } from "./app.js";

const app = createApp();
const port = 3000;

logger.info({ port }, "API server starting");

serve({ fetch: app.fetch, port }, () => {
  logger.info({ port }, "API server listening");
});
