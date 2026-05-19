/**
 * SLA Scheduler — polls the outbox for `workflow.sla_scheduled` events and
 * enqueues a BullMQ delayed job for each one.
 *
 * The job ID is deterministic: `sla:{outboxEventId}`.  This lets the engine
 * locate and cancel a job by computing its ID from the outbox record, without
 * needing a separate lookup table.
 *
 * Cancellation path: when executeTransition fires, it marks the relevant
 * `workflow.sla_scheduled` outbox event as delivered (preventing scheduling).
 * If the job was already enqueued, the sla-breacher guards against firing by
 * checking the instance's current state before writing the breach event.
 */

import { sql, inArray } from "drizzle-orm";
import { db, outboxEvents } from "@platform/db";
import { logger } from "@platform/logger";
import { slaQueue } from "./queues.js";

export type SlaJobData = {
  outboxEventId: string;
  tenantId: string;
  instanceId: string;
  workflowId: string;
  stateName: string;
  slaHours: number;
  fireAt: string;
};

const BATCH_SIZE = 50;
const DEFAULT_POLL_INTERVAL_MS = 10_000;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let activeTick: Promise<void> | null = null;

export async function tick(): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const rows = await tx.execute<{
        id: string;
        tenant_id: string;
        payload: {
          instanceId: string;
          workflowId: string;
          stateName: string;
          slaHours: number;
          fireAt: string;
        };
      }>(sql`
        SELECT id, tenant_id, payload
        FROM outbox_events
        WHERE delivered_at IS NULL
          AND event_type = 'workflow.sla_scheduled'
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${BATCH_SIZE}
      `);

      if (rows.length === 0) return;

      const now = Date.now();

      await Promise.all(
        rows.map((row) => {
          const fireAt = new Date(row.payload.fireAt).getTime();
          const delay = Math.max(0, fireAt - now);
          const jobId = `sla:${row.id}`;

          return slaQueue.add(
            "sla.breach",
            {
              outboxEventId: row.id,
              tenantId: row.tenant_id,
              instanceId: row.payload.instanceId,
              workflowId: row.payload.workflowId,
              stateName: row.payload.stateName,
              slaHours: row.payload.slaHours,
              fireAt: row.payload.fireAt,
            } satisfies SlaJobData,
            { jobId, delay },
          );
        }),
      );

      await tx
        .update(outboxEvents)
        .set({ deliveredAt: new Date() })
        .where(
          inArray(
            outboxEvents.id,
            rows.map((r) => r.id),
          ),
        );

      logger.info(
        { count: rows.length },
        "SLA scheduler: enqueued breach jobs",
      );
    });
  } catch (err) {
    logger.error({ err }, "SLA scheduler tick failed");
  }
}

export function startSlaScheduler(intervalMs = DEFAULT_POLL_INTERVAL_MS): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    activeTick = tick();
  }, intervalMs);
  logger.info({ intervalMs }, "SLA scheduler started");
}

export async function stopSlaScheduler(): Promise<void> {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (activeTick) {
    await activeTick;
    activeTick = null;
  }
  logger.info("SLA scheduler stopped");
}
