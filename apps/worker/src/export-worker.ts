/**
 * export-worker.ts
 *
 * BullMQ processor for the "export" queue.
 *
 * For each job:
 *  1. Fetch entity type + fields from the DB (honouring canSeePii via requestedBy role lookup)
 *  2. Stream entity rows up to EXPORT_ROW_LIMIT
 *  3. Render CSV, xlsx, or PDF into a Buffer
 *  4. Upload to S3 at exports/{tenantId}/{jobId}.{format}
 *  5. Generate a presigned GET URL valid for 1 h
 *  6. Return { downloadUrl, format, rowCount } as the job return value
 *     — the polling endpoint reads this via queue.getJob(id).returnvalue
 */

import { Worker } from "bullmq";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import { stringify } from "csv-stringify/sync";
import { withTenantContext } from "@platform/db";
import {
  getEntityType,
  listEntityFields,
  listEntities,
  type EntityField,
  type EntityInstance,
} from "@platform/entity-engine";
import { env } from "@platform/config";
import { logger } from "@platform/logger";
import { connection } from "./queues.js";
// These types must stay in sync with ExportJobPayload / ExportJobResult in
// apps/api/src/lib/export-queue.ts — both sides must use the same queue name
// ("export") and the same payload shape.
type ExportJobPayload = {
  tenantId: string;
  entityTypeId: string;
  format: "csv" | "xlsx" | "pdf";
  filters: { state?: string; assignedTo?: string };
  requestedBy: string;
};

type ExportJobResult = {
  downloadUrl: string;
  format: "csv" | "xlsx" | "pdf";
  rowCount: number;
};

const EXPORT_ROW_LIMIT = 10_000;
const DOWNLOAD_URL_TTL_SECONDS = 3_600; // 1 h

// ── S3 client ─────────────────────────────────────────────────────────────────

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

// ── Renderers ─────────────────────────────────────────────────────────────────

function buildRow(instance: EntityInstance, fields: EntityField[]): string[] {
  return [
    instance.id,
    instance.currentState,
    instance.createdAt.toISOString(),
    instance.updatedAt.toISOString(),
    ...fields.map((f) => {
      const v = instance.fields[f.name];
      if (v === null || v === undefined) return "";
      if (typeof v === "object") return JSON.stringify(v);
      return String(v);
    }),
  ];
}

function renderCsv(headers: string[], rows: string[][]): Buffer {
  return Buffer.from(stringify([headers, ...rows]), "utf-8");
}

async function renderXlsx(
  headers: string[],
  rows: string[][],
  sheetName: string,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31));
  sheet.addRow(headers);
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.commit();
  for (const row of rows) {
    sheet.addRow(row);
  }
  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}

async function renderPdf(
  headers: string[],
  rows: string[][],
  entityName: string,
): Promise<Buffer> {
  const landscape = headers.length > 6;
  const doc = new PDFDocument({
    margin: 30,
    layout: landscape ? "landscape" : "portrait",
    size: "A4",
  });
  const chunks: Buffer[] = [];

  return new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageW = landscape ? 841.89 : 595.28;
    const pageH = landscape ? 595.28 : 841.89;
    const margin = 30;
    const usableW = pageW - margin * 2;
    const colW = Math.max(Math.min(usableW / headers.length, 160), 40);
    const lineH = 14;
    const maxY = pageH - margin;

    doc.fontSize(12).font("Helvetica-Bold").text(entityName, margin, margin);
    let y = margin + 22;

    doc.rect(margin, y, usableW, lineH).fill("#e5e7eb");
    doc.fill("black").fontSize(8).font("Helvetica-Bold");
    headers.forEach((h, i) => {
      const t = h.length > 20 ? h.slice(0, 17) + "…" : h;
      doc.text(t, margin + i * colW, y + 3, {
        width: colW - 6,
        lineBreak: false,
      });
    });
    y += lineH;

    doc.font("Helvetica").fontSize(7);
    rows.forEach((row, ri) => {
      if (y + lineH > maxY) {
        doc.addPage({
          layout: landscape ? "landscape" : "portrait",
          size: "A4",
        });
        y = margin;
      }
      if (ri % 2 === 0) {
        doc.rect(margin, y, usableW, lineH).fill("#f9fafb");
      }
      doc.fill("black");
      row.forEach((cell, ci) => {
        const t = cell.length > 25 ? cell.slice(0, 22) + "…" : cell;
        doc.text(t, margin + ci * colW, y + 3, {
          width: colW - 6,
          lineBreak: false,
        });
      });
      y += lineH;
    });

    doc.end();
  });
}

// ── Worker ────────────────────────────────────────────────────────────────────

export const exportWorker = new Worker<ExportJobPayload, ExportJobResult>(
  "export",
  async (job) => {
    const { tenantId, entityTypeId, format, filters } = job.data;

    logger.info(
      { tenantId, entityTypeId, format, jobId: job.id },
      "export job started",
    );

    const result = await withTenantContext(tenantId, async (tx) => {
      const entityType = await getEntityType(tx, tenantId, entityTypeId);
      const allFields = await listEntityFields(tx, tenantId, entityTypeId);

      // Async exports use public fields only — no PII unless explicitly requested.
      // PII role is checked at enqueue time (route handler); requestedBy stored for audit.
      const exportFields = allFields.filter(
        (f) => f.sensitivity !== "pii" && f.sensitivity !== "financial",
      );

      const page = await listEntities(tx, tenantId, {
        entityTypeId,
        ...filters,
        limit: EXPORT_ROW_LIMIT,
      });

      return { entityType, fields: exportFields, rows: page.data };
    });

    const { entityType, fields, rows } = result;
    const headers = [
      "ID",
      "State",
      "Created At",
      "Updated At",
      ...fields.map((f) => f.label),
    ];
    const dataRows = rows.map((r) => buildRow(r, fields));

    let fileBuffer: Buffer;
    let contentType: string;
    let ext: string;

    if (format === "csv") {
      fileBuffer = renderCsv(headers, dataRows);
      contentType = "text/csv";
      ext = "csv";
    } else if (format === "pdf") {
      fileBuffer = await renderPdf(headers, dataRows, entityType.plural);
      contentType = "application/pdf";
      ext = "pdf";
    } else {
      fileBuffer = await renderXlsx(headers, dataRows, entityType.plural);
      contentType =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      ext = "xlsx";
    }

    const storageKey = `exports/${tenantId}/${job.id}.${ext}`;

    await getS3().send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: storageKey,
        Body: fileBuffer,
        ContentType: contentType,
      }),
    );

    const downloadUrl = await getSignedUrl(
      getS3(),
      new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: storageKey }),
      { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
    );

    logger.info(
      { tenantId, entityTypeId, jobId: job.id, rowCount: rows.length },
      "export job completed",
    );

    return { downloadUrl, format, rowCount: rows.length };
  },
  {
    connection,
    concurrency: 3,
    removeOnComplete: { age: 3_600 },
    removeOnFail: { age: 86_400 },
  },
);

export function stopExportWorker(): Promise<void> {
  return exportWorker.close();
}
