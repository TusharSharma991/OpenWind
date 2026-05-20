import type { Redis } from "ioredis";

const DEFAULT_THRESHOLD = 5;
const DEFAULT_TTL_SECONDS = 300;

// NOTE: This is a simple open/closed circuit breaker with no half-open state.
// When the TTL expires the counter key is deleted and the circuit closes cold —
// all traffic resumes immediately on the next request rather than being probed
// gradually. A proper half-open probe (let one request through to test recovery)
// would require an additional Redis key and is deferred as a future improvement.

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
