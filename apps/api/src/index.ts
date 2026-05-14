import { Hono } from "hono";
import { logger as honoLogger } from "hono/logger";
import { env } from "@platform/config";
import { logger } from "@platform/logger";

const app = new Hono();

app.use("*", honoLogger());

app.get("/health", (c) => c.json({ status: "ok", env: env.NODE_ENV }));

const port = 3000;
logger.info({ port }, "API server starting");

export default {
  port,
  fetch: app.fetch,
};
