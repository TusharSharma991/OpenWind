import { Queue } from "bullmq";
import type {
  ExportJobPayload,
  ExportJobResult,
} from "@platform/entity-engine";
import { connection } from "./redis.js";

export { type ExportJobPayload, type ExportJobResult };

export const PII_EXPORT_ROLES = new Set(["pii_export", "admin", "superadmin"]);

export const exportQueue = new Queue<ExportJobPayload, ExportJobResult>(
  "export",
  { connection },
);
