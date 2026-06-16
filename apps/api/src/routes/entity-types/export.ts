import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "@platform/auth";
import { withTenantContext } from "@platform/db";
import {
  getEntityType,
  listEntityFields,
  listEntities,
  EntityError,
  type EntityField,
  type EntityInstance,
} from "@platform/entity-engine";
import { stringify } from "csv-stringify/sync";
import ExcelJS from "exceljs";
import { factory } from "./factory.js";

const EXPORT_ROW_LIMIT = 10_000;

// Roles that may see PII / financial fields in an export
const PII_EXPORT_ROLES = new Set(["pii_export", "admin", "superadmin"]);

const ExportQuerySchema = z.object({
  format: z.enum(["csv", "xlsx"]),
  state: z.string().optional(),
  assignedTo: z.string().uuid().optional(),
});

export const exportEntitiesHandler = factory.createHandlers(
  requireAuth(),
  zValidator("query", ExportQuerySchema),
  async (c) => {
    const { tenantId, roles } = c.get("auth");
    const entityTypeId = c.req.param("id") ?? "";
    const { format, state, assignedTo } = c.req.valid("query");

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

      const countPage = await listEntities(tx, tenantId, {
        entityTypeId,
        ...(state !== undefined && { state }),
        ...(assignedTo !== undefined && { assignedTo }),
        limit: EXPORT_ROW_LIMIT + 1,
      });

      return { entityType, fields: exportFields, rows: countPage.data };
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
          count: rows.length,
        },
        400,
      );
    }

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

    function buildRow(instance: EntityInstance): string[] {
      const system = [
        instance.id,
        instance.currentState,
        instance.createdAt.toISOString(),
        instance.updatedAt.toISOString(),
      ];
      const fieldValues = fields.map((f) => {
        const v = instance.fields[f.name];
        if (v === null || v === undefined) return "";
        if (typeof v === "object") return JSON.stringify(v);
        return String(v);
      });
      return [...system, ...fieldValues];
    }

    if (format === "csv") {
      const csvData = stringify([headers, ...rows.map(buildRow)]);

      return c.newResponse(csvData, 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safePlural}-export-${dateStr}.csv"`,
      });
    }

    // ── xlsx ──────────────────────────────────────────────────────────────────
    const workbook = new ExcelJS.Workbook();
    const sheetName = entityType.plural.slice(0, 31);
    const sheet = workbook.addWorksheet(sheetName);

    sheet.addRow(headers);
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.commit();

    for (const instance of rows) {
      sheet.addRow(buildRow(instance));
    }

    // Auto-column width heuristic: max cell length, capped at 50
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

    return c.newResponse(buffer as unknown as string, 200, {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safePlural}-export-${dateStr}.xlsx"`,
    });
  },
);
