/**
 * Tenant purge worker — hard-deletes all data for a tenant scheduled for deletion.
 *
 * Triggered by a delayed BullMQ job (default 30-day delay) enqueued by
 * `scheduleTenantDeletion` in the API's tenant lifecycle service.
 *
 * Deletion order respects foreign key constraints (children before parents):
 *   files → entity instances/relations → workflow events → automation rules/executions
 *   → outbox events → connector credentials → api_keys → tenant_users
 *   → view_configs → admin_audit_log → tenant row (status → 'purged')
 *
 * Each step uses `withTenantContext` so RLS policies pass for the target tenant.
 * Tables without RLS (tenants, admin_audit_log) are deleted directly.
 *
 * The job is idempotent: re-running it after a partial failure is safe because
 * each DELETE targets `tenant_id = $tenantId` and missing rows are a no-op.
 */

import { Worker } from "bullmq";
import { eq, and } from "drizzle-orm";
import { db, withTenantContext } from "@platform/db";
import {
  tenants,
  files,
  viewConfigs,
  apiKeys,
  tenantUsers,
  connectorCredentials,
} from "@platform/db";
import { logger } from "@platform/logger";
import { connection } from "./queues.js";

// Engine-schema tables (exported from @platform/db via schema/index)
import {
  entityInstances,
  entityRelations,
  entityFields,
  entityTypes,
  workflowEvents,
  automationRules,
  automationExecutions,
  outboxEvents,
} from "@platform/db";

const QUEUE_NAME = "tenant-purge";

type PurgeJobData = { tenantId: string };

export const tenantPurgeWorker = new Worker<PurgeJobData>(
  QUEUE_NAME,
  async (job) => {
    const { tenantId } = job.data;
    logger.info({ tenantId, jobId: job.id }, "tenant-purge: starting");

    // Verify tenant is still in 'deleted' state (idempotency guard)
    const [tenant] = await db
      .select({ status: tenants.status })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!tenant) {
      logger.warn(
        { tenantId },
        "tenant-purge: tenant row not found — already purged",
      );
      return;
    }
    if (tenant.status !== "deleted") {
      logger.warn(
        { tenantId, status: tenant.status },
        "tenant-purge: tenant status is not 'deleted' — skipping",
      );
      return;
    }

    await withTenantContext(tenantId, async (tx) => {
      // Files — mark deleted (file-cleanup worker handles S3 removal)
      await tx
        .update(files)
        .set({ scanStatus: "deleted" })
        .where(and(eq(files.tenantId, tenantId)));
      logger.info({ tenantId }, "tenant-purge: files marked deleted");

      // Workflow events
      await tx
        .delete(workflowEvents)
        .where(eq(workflowEvents.tenantId, tenantId));
      logger.info({ tenantId }, "tenant-purge: workflow events deleted");

      // Entity relations (before instances — FK child)
      await tx
        .delete(entityRelations)
        .where(eq(entityRelations.tenantId, tenantId));

      // Entity instances
      await tx
        .delete(entityInstances)
        .where(eq(entityInstances.tenantId, tenantId));
      logger.info({ tenantId }, "tenant-purge: entity instances deleted");

      // Entity fields + types
      await tx.delete(entityFields).where(eq(entityFields.tenantId, tenantId));
      await tx.delete(entityTypes).where(eq(entityTypes.tenantId, tenantId));

      // Automation
      await tx
        .delete(automationExecutions)
        .where(eq(automationExecutions.tenantId, tenantId));
      await tx
        .delete(automationRules)
        .where(eq(automationRules.tenantId, tenantId));
      logger.info({ tenantId }, "tenant-purge: automation data deleted");

      // Outbox
      await tx.delete(outboxEvents).where(eq(outboxEvents.tenantId, tenantId));

      // Credentials + API keys
      await tx
        .delete(connectorCredentials)
        .where(eq(connectorCredentials.tenantId, tenantId));
      await tx.delete(apiKeys).where(eq(apiKeys.tenantId, tenantId));

      // Users + view config
      await tx.delete(tenantUsers).where(eq(tenantUsers.tenantId, tenantId));
      await tx.delete(viewConfigs).where(eq(viewConfigs.tenantId, tenantId));
    });

    // Audit log entries are retained for compliance — we do NOT delete them.
    // Mark the tenant row as 'purged' (keeps a tombstone for audit trail).
    await db
      .update(tenants)
      .set({ status: "purged", updatedAt: new Date() })
      .where(eq(tenants.id, tenantId));

    logger.info({ tenantId }, "tenant-purge: complete — tenant marked purged");
  },
  {
    connection,
    concurrency: 1, // one purge at a time to avoid DB contention
  },
);

tenantPurgeWorker.on("failed", (job, err) => {
  logger.error(
    { jobId: job?.id, tenantId: job?.data.tenantId, err: String(err) },
    "tenant-purge: job failed",
  );
});

export async function stopTenantPurgeWorker(): Promise<void> {
  await tenantPurgeWorker.close();
}
