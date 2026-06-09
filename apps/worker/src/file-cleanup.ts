/**
 * file-cleanup.ts
 *
 * Recurring BullMQ job (every hour) that purges stale pending files:
 *  - Files with scan_status = 'pending' and created_at < now() - 24h
 *  - Deletes the S3 object
 *  - Deletes the row from the files table
 *
 * Quota is implicit — it's the aggregate of active file rows.
 * Deleting the row automatically releases the used bytes from the aggregate.
 *
 * This handles the case where a client initiates an upload but never completes
 * it (client crash, network error, tab closed).
 */

import { Worker, Queue } from "bullmq";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { lt, eq, and } from "drizzle-orm";
import { db, files } from "@platform/db";
import { env } from "@platform/config";
import { logger } from "@platform/logger";
import { connection } from "./queues.js";

const STALE_AFTER_HOURS = 24;
const QUEUE_NAME = "file-cleanup";

// ── S3 client (lazily initialised — avoids top-level instantiation in tests) ──

let _s3: S3Client | undefined;
function getS3(): S3Client {
  _s3 ??= new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: "us-east-1",
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
    },
    forcePathStyle: true,
  });
  return _s3;
}

// ── Cleanup processor ─────────────────────────────────────────────────────────

async function runCleanup(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_AFTER_HOURS * 60 * 60 * 1000);

  const staleFiles = await db
    .select({
      id: files.id,
      tenantId: files.tenantId,
      storageKey: files.storageKey,
      sizeBytes: files.sizeBytes,
    })
    .from(files)
    .where(and(eq(files.scanStatus, "pending"), lt(files.createdAt, cutoff)));

  if (staleFiles.length === 0) {
    logger.info("file-cleanup: no stale files found");
    return;
  }

  logger.info(
    { count: staleFiles.length },
    "file-cleanup: purging stale pending files",
  );

  let purged = 0;
  let errors = 0;

  for (const file of staleFiles) {
    try {
      // Delete S3 object (best-effort; row deletion still proceeds on S3 error)
      try {
        await getS3().send(
          new DeleteObjectCommand({
            Bucket: env.S3_BUCKET,
            Key: file.storageKey,
          }),
        );
      } catch (s3Err) {
        logger.warn(
          { tenantId: file.tenantId, fileId: file.id, err: String(s3Err) },
          "file-cleanup: S3 deletion failed — continuing with row cleanup",
        );
      }

      // Delete the row — quota is implicit (aggregate of active file rows)
      await db.delete(files).where(eq(files.id, file.id));

      purged++;
      logger.info(
        { tenantId: file.tenantId, fileId: file.id },
        "file-cleanup: stale file purged",
      );
    } catch (err) {
      errors++;
      logger.error(
        { tenantId: file.tenantId, fileId: file.id, err: String(err) },
        "file-cleanup: failed to purge file",
      );
    }
  }

  logger.info({ purged, errors }, "file-cleanup: run complete");
}

// ── BullMQ worker + recurring schedule ───────────────────────────────────────

export const fileCleanupWorker = new Worker(
  QUEUE_NAME,
  async () => {
    await runCleanup();
  },
  { connection },
);

fileCleanupWorker.on("failed", (_job, err) => {
  logger.error({ err: String(err) }, "file-cleanup: worker job failed");
});

/**
 * Schedule a recurring cleanup job (runs every hour).
 * Uses BullMQ's repeatable jobs so only one instance runs at a time even if
 * multiple worker processes are running.
 */
export async function scheduleFileCleanup(): Promise<void> {
  const queue = new Queue(QUEUE_NAME, { connection });
  await queue.add(
    "cleanup",
    {},
    {
      repeat: { pattern: "0 * * * *" }, // every hour on the hour
      jobId: "file-cleanup-recurring",
    },
  );
  await queue.close();
  logger.info("file-cleanup: recurring job scheduled (every 1h)");
}

export async function stopFileCleanupWorker(): Promise<void> {
  await fileCleanupWorker.close();
}
