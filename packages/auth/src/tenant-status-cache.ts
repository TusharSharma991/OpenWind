/**
 * In-process tenant status cache — SINGLE-PROCESS SCOPE ONLY.
 *
 * Avoids a DB round-trip on every authenticated request. 30 s TTL caps the
 * staleness window. `invalidateTenantStatusCache` takes effect immediately
 * for the current process only — other API instances retain their cached value
 * for up to TTL_MS after a lifecycle transition (suspend / delete). In a
 * horizontally-scaled deployment, a Redis pub/sub invalidation channel is
 * required for immediate cross-instance propagation.
 */

const TTL_MS = 30_000;

const _cache = new Map<string, { status: string; exp: number }>();

export function getCachedTenantStatus(tenantId: string): string | undefined {
  const entry = _cache.get(tenantId);
  if (!entry) return undefined;
  if (Date.now() > entry.exp) {
    _cache.delete(tenantId);
    return undefined;
  }
  return entry.status;
}

export function setCachedTenantStatus(tenantId: string, status: string): void {
  _cache.set(tenantId, { status, exp: Date.now() + TTL_MS });
}

export function invalidateTenantStatusCache(tenantId: string): void {
  _cache.delete(tenantId);
}
