import { Worker, type Job } from "bullmq";
import Redis from "ioredis";
import { withTenantContext, deadLetterEvents } from "@platform/db";
import { executeAutomationRules } from "@platform/automation-engine";
import { env } from "@platform/config";
import { logger } from "@platform/logger";

// maxRetriesPerRequest must be null for BullMQ worker connections;
// without it a transient Redis blip throws MaxRetriesPerRequestError and drops jobs.
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

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
    // Pass the Redis connection so the circuit breaker is active.
    // Without this argument the circuit breaker guard is silently skipped.
    await withTenantContext(tenantId, (tx) =>
      executeAutomationRules(tx, tenantId, payload, 0, connection),
    );
  },
  { connection, concurrency: 5 },
);

async function handleFailedJob(
  job: Job<AutomationJobData> | undefined,
  err: Error,
): Promise<void> {
  if (!job || (job.opts.attempts ?? 1) > job.attemptsMade) return;

  const { outboxEventId, tenantId, eventType, payload, ruleId } =
    job.data as AutomationJobData;

  try {
    // Use withTenantContext so the insert runs with tenant_id set consistently
    // with all other writes — defensive against any future RLS reinstatement.
    await withTenantContext(tenantId, (tx) =>
      tx.insert(deadLetterEvents).values({
        tenantId,
        originalEventId: outboxEventId,
        eventType,
        payload: payload as Record<string, unknown>,
        ruleId: ruleId ?? null,
        error: err.message,
        attemptCount: job.attemptsMade,
      }),
    );
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
}

automationWorker.on("failed", (job, err) => {
  void handleFailedJob(job, err);
});

export function stopAutomationWorker(): Promise<void> {
  return automationWorker.close();
}
