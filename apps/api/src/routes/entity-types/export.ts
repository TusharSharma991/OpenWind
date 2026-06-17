import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import PDFDocument from "pdfkit";
import { requireAuth } from "@platform/auth";
import { withTenantContext } from "@platform/db";
import {
  getEntityType,
  listEntityFields,
  listEntities,
  EntityError,
  buildExportRow,
  type EntityField,
} from "@platform/entity-engine";
import { stringify } from "csv-stringify/sync";
import ExcelJS from "exceljs";
import { exportQueue } from "../../lib/export-queue.js";
import { factory } from "./factory.js";

const SYNC_ROW_LIMIT = 5_000;
const EXPORT_ROW_LIMIT = 10_000;

const PII_EXPORT_ROLES = new Set(["pii_export", "admin", "superadmin"]);

// Tailwind gray-200 / gray-50 — match the admin-ui table palette
const PDF_HEADER_BG = "#e5e7eb";
const PDF_ROW_ALT_BG = "#f9fafb";

const ExportQuerySchema = z.object({
  format: z.enum(["csv", "xlsx", "pdf"]),
  state: z.string().optional(),
  assignedTo: z.string().uuid().optional(),
});

// ── PDF builder ───────────────────────────────────────────────────────────────

async function buildPdf(
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

    doc.rect(margin, y, usableW, lineH).fill(PDF_HEADER_BG);
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
        doc.rect(margin, y, usableW, lineH).fill(PDF_ROW_ALT_BG);
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

// ── Route handler ─────────────────────────────────────────────────────────────

export const exportEntitiesHandler = factory.createHandlers(
  requireAuth(),
  zValidator("query", ExportQuerySchema),
  async (c) => {
    const { tenantId, userId, roles } = c.get("auth");
    const entityTypeId = c.req.param("id") ?? "";
    const { format, state, assignedTo } = c.req.valid("query");
    const filters = {
      ...(state !== undefined && { state }),
      ...(assignedTo !== undefined && { assignedTo }),
    };

    const canSeePii = roles.some((r) => PII_EXPORT_ROLES.has(r));

    const result = await withTenantContext(tenantId, async (tx) => {
      let entityType;
      try {
        entityType = await getEntityType(tx, tenantId, entityTypeId);
      } catch (err) {
        if (
          err instanceof EntityError &&
          err.code === "ENTITY_TYPE_NOT_FOUND"
        ) {
          return null;
        }
        throw err;
      }

      const allFields = await listEntityFields(tx, tenantId, entityTypeId);
      const exportFields: EntityField[] = canSeePii
        ? allFields
        : allFields.filter(
            (f) => f.sensitivity !== "pii" && f.sensitivity !== "financial",
          );

      const page = await listEntities(tx, tenantId, {
        entityTypeId,
        ...filters,
        limit: EXPORT_ROW_LIMIT + 1,
      });

      return { entityType, fields: exportFields, rows: page.data };
    });

    if (!result) {
      return c.json(
        { error: "NOT_FOUND", message: "Entity type not found" },
        404,
      );
    }

    const { entityType, fields, rows } = result;

    if (rows.length > EXPORT_ROW_LIMIT) {
      return c.json(
        {
          error: "EXPORT_TOO_LARGE",
          message: `Export exceeds ${EXPORT_ROW_LIMIT} rows. Apply filters to narrow the result set.`,
        },
        400,
      );
    }

    // ── Async path ─────────────────────────────────────────────────────────────
    if (rows.length > SYNC_ROW_LIMIT) {
      const job = await exportQueue.add("export", {
        tenantId,
        entityTypeId,
        format,
        filters,
        requestedBy: userId,
        includePii: canSeePii,
      });
      return c.json({ jobId: job.id }, 202);
    }

    // ── Sync path ─────────────────────────────────────────────────────────────
    const dateStr = new Date().toISOString().slice(0, 10);
    const safePlural = entityType.plural
      .replace(/[^a-z0-9]/gi, "-")
      .toLowerCase();
    const headers = [
      "ID",
      "State",
      "Created At",
      "Updated At",
      ...fields.map((f) => f.label),
    ];
    const dataRows = rows.map((r) => buildExportRow(r, fields));

    if (format === "csv") {
      const csvData = stringify([headers, ...dataRows]);
      return c.newResponse(csvData, 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safePlural}-export-${dateStr}.csv"`,
      });
    }

    if (format === "pdf") {
      const pdfBuffer = await buildPdf(headers, dataRows, entityType.plural);
      // Hono's newResponse accepts BodyInit; Buffer is not in that union but
      // works at runtime via Node.js's fetch-compatible body handling.
      return c.newResponse(pdfBuffer as unknown as string, 200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safePlural}-export-${dateStr}.pdf"`,
      });
    }

    // xlsx
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(entityType.plural.slice(0, 31));
    sheet.addRow(headers);
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.commit();
    for (const row of rows) {
      sheet.addRow(buildExportRow(row, fields));
    }
    for (let i = 1; i <= headers.length; i++) {
      const col = sheet.getColumn(i);
      let maxLen = 10;
      col.eachCell({ includeEmpty: false }, (cell) => {
        const len =
          cell.value !== null && cell.value !== undefined
            ? String(cell.value).length
            : 0;
        if (len > maxLen) maxLen = len;
      });
      col.width = Math.min(maxLen + 2, 50);
    }
    const buffer = await workbook.xlsx.writeBuffer();
    // Same as pdfBuffer cast above — Buffer satisfies BodyInit at runtime.
    return c.newResponse(buffer as unknown as string, 200, {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safePlural}-export-${dateStr}.xlsx"`,
    });
  },
);
