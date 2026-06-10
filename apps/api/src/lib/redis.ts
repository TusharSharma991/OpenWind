/**
 * Shared Redis client for the API server.
 *
 * Used by @platform/notifications (template cache validation) and
 * @platform/files (AV scan queue).  The same connection options as the
 * worker are used: maxRetriesPerRequest: null prevents MaxRetriesPerRequestError
 * on transient Redis unavailability.
 */
import Redis from "ioredis";
import { env } from "@platform/config";

export const connection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});
