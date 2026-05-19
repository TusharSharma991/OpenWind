/**
 * SLA Breacher — BullMQ worker that fires when a delayed SLA job becomes due.
 *
 * Guard: before writing the breach event it checks that the entity instance is
 * still in the expected state.  If the instance has already transitioned away,
 * the job is a no-op.  This handles the race where the transition and the job
 * fire concurrently — the engine's cancelPendingSlaTimers only covers jobs that
 * haven't been enqueued yet.
 */

import { Worker } from "bullmq";
import { eq, and } from "drizzle-orm";
import { db, outboxEvents, entityInstances } from "@platform/db";
import { logger } from "@platform/logger";
import { connection } from "./queues.js";
import type { SlaJobData } from "./sla-scheduler.js";

export const slaBreacher = new Worker<SlaJobData>(
  "sla",
  async (job) => {
    const {
      outboxEventId,
      tenantId,
      instanceId,
      workflowId,
      stateName,
      slaHours,
    } = job.data;

    // Guard: is the instance still in the SLA-tracked state?
    const [instance] = await db
      .select({ currentState: entityInstances.currentState })
      .from(entityInstances)
      .where(
        and(
          eq(entityInstances.id, instanceId),
          eq(entityInstances.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!instance) {
      logger.info(
        { tenantId, instanceId, stateName, outboxEventId },
        "SLA breach: instance not found — skipping",
      );
      return;
    }

    if (instance.currentState !== stateName) {
      logger.info(
        {
          tenantId,
          instanceId,
          stateName,
          currentState: instance.currentState,
          outboxEventId,
        },
        "SLA breach: instance already transitioned — skipping",
      );
      return;
    }

    // Write the breach event to the outbox.  The outbox poller routes it to
    // the automation queue where automation rules with trigger workflow.sla_breached
    // are evaluated.
    await db.insert(outboxEvents).values({
      tenantId,
      eventType: "workflow.sla_breached",
      version: 1,
      payload: {
        eventType: "workflow.sla_breached",
        version: 1,
        tenantId,
        instanceId,
        workflowId,
        stateName,
        slaHours,
        occurredAt: new Date().toISOString(),
      },
    });

    logger.info(
      { tenantId, instanceId, stateName, slaHours, outboxEventId },
      "SLA breach: outbox event written",
    );
  },
  { connection },
);

slaBreacher.on("failed", (job, err) => {
  logger.error(
    { jobId: job?.id, data: job?.data, err },
    "SLA breach job failed",
  );
});
