import { Queue } from "bullmq";
import Redis from "ioredis";
import { env } from "@platform/config";

// maxRetriesPerRequest must be null for BullMQ connections passed as Redis instances.
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

export const automationQueue = new Queue("automation", { connection });
