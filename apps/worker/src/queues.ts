import { Queue } from "bullmq";
import Redis from "ioredis";
import { env } from "@platform/config";

const connection = new Redis(env.REDIS_URL);

export const automationQueue = new Queue("automation", { connection });
