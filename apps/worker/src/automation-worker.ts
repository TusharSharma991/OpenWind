import { Worker } from "bullmq";
import { createClient } from "ioredis";
import { db, withTenantContext, deadLetterEvents } from "@platform/db";
import { executeAutomationRules } from "@platform/automation-engine";
import { env } from "@platform/config";
import { logger } from "@platform/logger";
import { automationQueue } from "./queues.js";

const connection = createClient(env.REDIS_URL);

interface AutomationJobData {
  outboxEventId: string;
  tenantId: string;
  eventType: string;
  version: number;
  payload: unknown;
  ruleId?: string;
}

export const automationWorker = new Worker<AutomationJobData>(
  "automation",
  async (job) => {
    const { tenantId, payload } = job.data;
    await withTenantContext(tenantId, (tx) =>
      executeAutomationRules(tx, tenantId, payload),
    );
  },
  { connection, concurrency: 5 },
);

automationWorker.on("failed", async (job, err) => {
  if (!job || (job.opts.attempts ?? 1) > (job.attemptsMade ?? 0)) return;

  const { outboxEventId, tenantId, eventType, payload, ruleId } =
    job.data as AutomationJobData;

  try {
    await db.insert(deadLetterEvents).values({
      tenantId,
      originalEventId: outboxEventId,
      eventType,
      payload: payload as Record<string, unknown>,
      ruleId: ruleId ?? null,
      error: err.message,
      attemptCount: job.attemptsMade ?? 1,
    });
    logger.warn(
      { tenantId, outboxEventId, eventType },
      "Automation: job moved to dead letter queue",
    );
  } catch (dlqErr) {
    logger.error(
      { tenantId, outboxEventId, dlqErr },
      "Automation: failed to write to dead letter queue",
    );
  }
});

export function stopAutomationWorker(): Promise<void> {
  return automationWorker.close();
}
