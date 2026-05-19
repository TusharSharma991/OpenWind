import { logger } from "@platform/logger";
import { startOutboxPoller, stopOutboxPoller } from "./outbox-poller.js";

logger.info("Worker process starting");

startOutboxPoller();

async function shutdown() {
  logger.info("Worker shutting down");
  await stopOutboxPoller();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
