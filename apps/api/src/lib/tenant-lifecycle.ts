/**
 * Tenant lifecycle service.
 *
 * State machine:  provisioning → active → suspended → deleted → (purged by worker)
 *
 * All transitions are written to admin_audit_log.  The tenant-purge BullMQ
 * worker runs after deletion_scheduled_at and hard-deletes all tenant data.
 */

import { Queue } from "bullmq";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, tenants } from "@platform/db";
import { writeAuditEntry } from "@platform/audit";
import { logger } from "@platform/logger";
import { connection } from "./redis.js";
import { invalidateTenantStatusCache } from "@platform/auth";

// One Queue instance per process for enqueuing — the worker holds the Worker.
const tenantPurgeQueue = new Queue("tenant-purge", { connection });

// ── Schemas ───────────────────────────────────────────────────────────────────

export const ProvisionTenantSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric with hyphens"),
  plan: z.enum(["standard", "professional", "enterprise"]).default("standard"),
  config: z.record(z.unknown()).optional(),
});

export type ProvisionTenantInput = z.infer<typeof ProvisionTenantSchema>;

// ── Errors ────────────────────────────────────────────────────────────────────

export class TenantLifecycleError extends Error {
  constructor(
    public readonly code:
      | "TENANT_NOT_FOUND"
      | "INVALID_TRANSITION"
      | "SLUG_TAKEN",
    public readonly meta?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "TenantLifecycleError";
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DEFAULT_DELETION_DELAY_DAYS = 30;

async function loadTenant(
  tenantId: string,
): Promise<typeof tenants.$inferSelect> {
  const [row] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!row) throw new TenantLifecycleError("TENANT_NOT_FOUND", { tenantId });
  return row;
}

function assertTransition(
  current: string,
  allowed: string[],
  tenantId: string,
): void {
  if (!allowed.includes(current)) {
    throw new TenantLifecycleError("INVALID_TRANSITION", {
      tenantId,
      currentStatus: current,
      allowedFrom: allowed,
    });
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create a new tenant and immediately activate it.
 * Writes a 'created' audit entry against the new tenant's own ID.
 */
export async function provisionTenant(
  input: ProvisionTenantInput,
  actorId: string,
): Promise<{ id: string; slug: string }> {
  const parsed = ProvisionTenantSchema.parse(input);

  const [existing] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, parsed.slug))
    .limit(1);
  if (existing) {
    throw new TenantLifecycleError("SLUG_TAKEN", { slug: parsed.slug });
  }

  const now = new Date();
  const [row] = await db
    .insert(tenants)
    .values({
      name: parsed.name,
      slug: parsed.slug,
      plan: parsed.plan,
      status: "active",
      config: parsed.config ?? {},
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: tenants.id, slug: tenants.slug });

  if (!row) throw new Error("tenant insert returned no row");

  await writeAuditEntry(db, {
    tenantId: row.id,
    actorId,
    actorType: "user",
    resourceType: "tenant",
    resourceId: row.id,
    action: "created",
    afterSnapshot: { name: parsed.name, slug: parsed.slug, plan: parsed.plan },
  });

  logger.info(
    { tenantId: row.id, slug: row.slug, actorId },
    "tenant: provisioned",
  );
  return { id: row.id, slug: row.slug };
}

/**
 * Suspend a tenant: blocks API access immediately (auth middleware cache
 * invalidated), preserves all data.
 *
 * Allowed from: active
 */
export async function suspendTenant(
  tenantId: string,
  actorId: string,
): Promise<void> {
  const tenant = await loadTenant(tenantId);
  assertTransition(tenant.status, ["active"], tenantId);

  const now = new Date();
  await db
    .update(tenants)
    .set({ status: "suspended", suspendedAt: now, updatedAt: now })
    .where(eq(tenants.id, tenantId));

  invalidateTenantStatusCache(tenantId);

  await writeAuditEntry(db, {
    tenantId,
    actorId,
    actorType: "user",
    resourceType: "tenant",
    resourceId: tenantId,
    action: "transitioned",
    beforeSnapshot: { status: tenant.status },
    afterSnapshot: { status: "suspended" },
  });

  logger.info({ tenantId, actorId }, "tenant: suspended");
}

/**
 * Reactivate a suspended tenant.
 *
 * Allowed from: suspended
 */
export async function reactivateTenant(
  tenantId: string,
  actorId: string,
): Promise<void> {
  const tenant = await loadTenant(tenantId);
  assertTransition(tenant.status, ["suspended"], tenantId);

  const now = new Date();
  await db
    .update(tenants)
    .set({ status: "active", suspendedAt: null, updatedAt: now })
    .where(eq(tenants.id, tenantId));

  invalidateTenantStatusCache(tenantId);

  await writeAuditEntry(db, {
    tenantId,
    actorId,
    actorType: "user",
    resourceType: "tenant",
    resourceId: tenantId,
    action: "transitioned",
    beforeSnapshot: { status: tenant.status },
    afterSnapshot: { status: "active" },
  });

  logger.info({ tenantId, actorId }, "tenant: reactivated");
}

/**
 * Schedule a tenant for GDPR deletion.
 *
 * Sets status → 'deleted' immediately (blocks API access) and enqueues a
 * BullMQ purge job to hard-delete all data after `delayDays` (default 30).
 *
 * Allowed from: active | suspended
 */
export async function scheduleTenantDeletion(
  tenantId: string,
  actorId: string,
  delayDays = DEFAULT_DELETION_DELAY_DAYS,
): Promise<{ deletionScheduledAt: Date }> {
  const tenant = await loadTenant(tenantId);
  assertTransition(tenant.status, ["active", "suspended"], tenantId);

  const delayMs = delayDays * 24 * 60 * 60 * 1000;
  const deletionScheduledAt = new Date(Date.now() + delayMs);
  const now = new Date();

  await db
    .update(tenants)
    .set({
      status: "deleted",
      deletionScheduledAt,
      updatedAt: now,
    })
    .where(eq(tenants.id, tenantId));

  invalidateTenantStatusCache(tenantId);

  // Enqueue the purge job — runs after the scheduled delay
  await tenantPurgeQueue.add(
    "purge",
    { tenantId },
    {
      delay: delayMs,
      jobId: `tenant-purge-${tenantId}`, // deduplication key
      attempts: 5,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: { age: 7 * 24 * 3600 },
      removeOnFail: false, // keep failed purge jobs for inspection
    },
  );

  await writeAuditEntry(db, {
    tenantId,
    actorId,
    actorType: "user",
    resourceType: "tenant",
    resourceId: tenantId,
    action: "deleted",
    beforeSnapshot: { status: tenant.status },
    afterSnapshot: {
      status: "deleted",
      deletionScheduledAt: deletionScheduledAt.toISOString(),
    },
    metadata: { delayDays },
  });

  logger.info(
    { tenantId, actorId, deletionScheduledAt, delayDays },
    "tenant: deletion scheduled",
  );

  return { deletionScheduledAt };
}
