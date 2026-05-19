import type { Redis } from "ioredis";

const DEFAULT_THRESHOLD = 5;
const DEFAULT_TTL_SECONDS = 300;

function key(tenantId: string, actionType: string): string {
  return `circuit:${tenantId}:${actionType}`;
}

export async function isOpen(
  redis: Redis,
  tenantId: string,
  actionType: string,
  threshold = DEFAULT_THRESHOLD,
): Promise<boolean> {
  const val = await redis.get(key(tenantId, actionType));
  return val !== null && parseInt(val, 10) >= threshold;
}

export async function recordFailure(
  redis: Redis,
  tenantId: string,
  actionType: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<void> {
  const k = key(tenantId, actionType);
  const current = await redis.incr(k);
  if (current === 1) {
    await redis.expire(k, ttlSeconds);
  }
}

export async function reset(
  redis: Redis,
  tenantId: string,
  actionType: string,
): Promise<void> {
  await redis.del(key(tenantId, actionType));
}
