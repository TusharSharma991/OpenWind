import { Queue } from "bullmq";
import { connection } from "./redis.js";

export const PII_EXPORT_ROLES = new Set(["pii_export", "admin", "superadmin"]);

export type ExportJobPayload = {
  tenantId: string;
  entityTypeId: string;
  format: "csv" | "xlsx" | "pdf";
  filters: { state?: string; assignedTo?: string };
  requestedBy: string;
  includePii: boolean;
};

export type ExportJobResult = {
  downloadUrl: string;
  format: "csv" | "xlsx" | "pdf";
  rowCount: number;
};

export const exportQueue = new Queue<ExportJobPayload, ExportJobResult>(
  "export",
  { connection },
);
