import { useState, useEffect, useRef, type RefObject } from "react";
import { fetchWithAuth, fetchRawWithAuth, API_URL } from "./api.js";

export type ExportStatus = "idle" | "loading" | "polling" | "ready" | "error";

export type UseExportReturn = {
  exportStatus: ExportStatus;
  exportError: string | null;
  exportDownloadUrl: string | null;
  showFormatPicker: boolean;
  formatPickerRef: RefObject<HTMLDivElement>;
  setShowFormatPicker: (v: boolean) => void;
  handleExport: (format: "csv" | "xlsx" | "pdf") => Promise<void>;
  triggerAsyncDownload: () => void;
  resetExport: () => void;
};

export function useExport(entityTypeId: string | undefined): UseExportReturn {
  const [exportStatus, setExportStatus] = useState<ExportStatus>("idle");
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const [exportDownloadUrl, setExportDownloadUrl] = useState<string | null>(
    null,
  );
  const [exportError, setExportError] = useState<string | null>(null);
  const [showFormatPicker, setShowFormatPicker] = useState(false);
  const formatPickerRef = useRef<HTMLDivElement>(null);

  // Poll until the async job finishes
  useEffect(() => {
    if (exportStatus !== "polling" || !exportJobId) return;
    let cancelled = false;

    async function poll(): Promise<void> {
      if (cancelled) return;
      try {
        const res = (await fetchWithAuth(
          `${API_URL}/exports/${exportJobId}/download`,
        )) as { status: string; downloadUrl?: string };
        if (res.status === "complete" && res.downloadUrl) {
          setExportDownloadUrl(res.downloadUrl);
          setExportStatus("ready");
        } else if (res.status === "failed") {
          setExportError("Export failed on the server. Please try again.");
          setExportStatus("error");
        } else {
          setTimeout(() => void poll(), 3_000);
        }
      } catch {
        setExportError("Could not check export status. Please try again.");
        setExportStatus("error");
      }
    }

    const timer = setTimeout(() => void poll(), 3_000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [exportStatus, exportJobId]);

  async function handleExport(format: "csv" | "xlsx" | "pdf"): Promise<void> {
    if (
      !entityTypeId ||
      exportStatus === "loading" ||
      exportStatus === "polling"
    )
      return;
    setShowFormatPicker(false);
    setExportStatus("loading");
    setExportError(null);
    setExportJobId(null);
    setExportDownloadUrl(null);
    try {
      const response = await fetchRawWithAuth(
        `${API_URL}/entity-types/${entityTypeId}/export?format=${format}`,
      );
      if (response.status === 400) {
        const body = (await response.json()) as {
          error: string;
          message?: string;
        };
        setExportError(
          body.error === "EXPORT_TOO_LARGE"
            ? "Export exceeds 10,000 row limit. Refine your filters and try again."
            : (body.message ?? "Export failed"),
        );
        setExportStatus("error");
        return;
      }
      if (response.status === 202) {
        const body = (await response.json()) as { jobId: string };
        setExportJobId(body.jobId);
        setExportStatus("polling");
        return;
      }
      if (response.ok) {
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = `export.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
        setExportStatus("idle");
        return;
      }
      setExportError(`Unexpected response: ${String(response.status)}`);
      setExportStatus("error");
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
      setExportStatus("error");
    }
  }

  function triggerAsyncDownload(): void {
    if (!exportDownloadUrl) return;
    const a = document.createElement("a");
    a.href = exportDownloadUrl;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setExportStatus("idle");
    setExportDownloadUrl(null);
    setExportJobId(null);
  }

  function resetExport(): void {
    setExportStatus("idle");
    setExportJobId(null);
    setExportDownloadUrl(null);
    setExportError(null);
  }

  return {
    exportStatus,
    exportError,
    exportDownloadUrl,
    showFormatPicker,
    formatPickerRef,
    setShowFormatPicker,
    handleExport,
    triggerAsyncDownload,
    resetExport,
  };
}
