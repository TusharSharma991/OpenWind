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
