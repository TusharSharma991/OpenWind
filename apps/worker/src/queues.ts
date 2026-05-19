import { Queue } from "bullmq";
import { createClient } from "ioredis";
import { env } from "@platform/config";

const connection = createClient(env.REDIS_URL);

export const automationQueue = new Queue("automation", { connection });
