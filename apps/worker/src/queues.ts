import { Queue } from "bullmq";
import Redis from "ioredis";
import { env } from "@platform/config";

// Shared Redis connection for all queues.
// maxRetriesPerRequest: null is required for BullMQ workers — without it,
// transient Redis unavailability throws MaxRetriesPerRequestError and drops
// jobs instead of retrying.
export const connection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const automationQueue = new Queue("automation", { connection });

// Default job options apply to every job added to this queue.
// attempts: 3 with exponential backoff means transient DB failures are retried
// before the job is considered failed and written to dead_letter_events.
export const slaQueue = new Queue("sla", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1_000 },
  },
});

// AV scan queue — processes file upload scans (pending → clean|quarantined|scan_failed)
// attempts: 5 with exponential backoff (1s, 2s, 4s, 8s, 16s)
export const avScanQueue = new Queue("av-scan", {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 1_000 },
    removeOnComplete: { age: 3_600 }, // 1h
    removeOnFail: { age: 604_800 }, // 7d
  },
});

// File cleanup queue — purges stale pending uploads (runs every 1h via repeatable job)
export const fileCleanupQueue = new Queue("file-cleanup", { connection });
