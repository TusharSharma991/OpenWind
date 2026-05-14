import { logger } from "@platform/logger";

logger.info("Worker process starting");

process.on("SIGTERM", () => {
  logger.info("Worker shutting down");
  process.exit(0);
});
