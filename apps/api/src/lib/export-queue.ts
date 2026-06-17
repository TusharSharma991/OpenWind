import { Queue } from "bullmq";
import { connection } from "./redis.js";

export type ExportJobPayload = {
  tenantId: string;
  entityTypeId: string;
  format: "csv" | "xlsx" | "pdf";
  filters: { state?: string; assignedTo?: string };
  requestedBy: string;
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
