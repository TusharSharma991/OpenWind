/**
 * In-process cache for tenant status lookups.
 *
 * Avoids a DB round-trip on every authenticated request.  30 s TTL means a
 * suspension propagates to all in-flight requests within half a minute.
 * Call `invalidateTenantStatusCache` immediately after a lifecycle transition
 * (in the same process) to push the change through without waiting for TTL.
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
