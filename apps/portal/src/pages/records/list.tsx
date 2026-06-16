import React, { useEffect, useRef, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { fetchWithAuth, API_URL } from "../../auth.js";
import { useEntityTypes } from "../../entity-type-context.js";

type SavedView = {
  id: string;
  name: string;
  filterConfig: { search?: string } | null;
  isDefault: boolean;
};

type EntityField = {
  id: string;
  name: string;
  label: string;
  fieldType: string;
  isSystem: boolean;
};
type EntityInstance = {
  id: string;
  currentState: string | null;
  fields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

function fieldDisplay(value: unknown, fieldType: string): string {
  if (value === null || value === undefined) return "—";
  if (fieldType === "boolean") return String(value) === "true" ? "Yes" : "No";
  if (fieldType === "date" || fieldType === "datetime") {
    const d = new Date(value as string);
    return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString();
  }
  return String(value);
}

function StateChip({ state }: { state: string | null }): React.ReactElement {
  if (!state) return <span className="rl-muted">—</span>;
  const lower = state.toLowerCase();
  let mod = "";
  if (
    lower.includes("open") ||
    lower.includes("new") ||
    lower.includes("active")
  )
    mod = "rl-state--open";
  else if (
    lower.includes("done") ||
    lower.includes("closed") ||
    lower.includes("resolved") ||
    lower.includes("complete")
  )
    mod = "rl-state--done";
  else if (
    lower.includes("progress") ||
    lower.includes("review") ||
    lower.includes("pending")
  )
    mod = "rl-state--progress";
  return <span className={`rl-state-chip ${mod}`}>{state}</span>;
}

export function RecordList(): React.ReactElement {
  const { typeSlug } = useParams<{ typeSlug: string }>();
  const navigate = useNavigate();
  const { getTypeBySlug } = useEntityTypes();

  const entityType = typeSlug ? getTypeBySlug(typeSlug) : undefined;
  const entityTypeId = entityType?.id;

  const [fields, setFields] = useState<EntityField[]>([]);
  const [records, setRecords] = useState<EntityInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // T21: Saved views
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [newViewName, setNewViewName] = useState("");
  const [newViewDefault, setNewViewDefault] = useState(false);
  const [savingView, setSavingView] = useState(false);
  const viewsRef = useRef<HTMLDivElement>(null);

  // T21: Export
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!entityTypeId) return;
    setLoading(true);
    setError(null);

    Promise.all([
      fetchWithAuth(`${API_URL}/entity-types/${entityTypeId}/fields`),
      fetchWithAuth(`${API_URL}/entities?entityTypeId=${entityTypeId}`),
    ])
      .then(([fieldsRes, recRes]) => {
        setFields(
          (fieldsRes as { data: EntityField[] }).data.filter(
            (f) => !f.isSystem,
          ),
        );
        setRecords((recRes as { data?: EntityInstance[] }).data ?? []);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => setLoading(false));
  }, [entityTypeId]);

  // T21: Load saved views
  useEffect(() => {
    if (!entityTypeId) return;
    fetchWithAuth(`${API_URL}/saved-views?entityTypeId=${entityTypeId}`)
      .then((res) => {
        const views = (res as { data?: SavedView[] }).data ?? [];
        setSavedViews(views);
        const def = views.find((v) => v.isDefault);
        if (def) {
          setActiveViewId(def.id);
          setSearch(def.filterConfig?.search ?? "");
        }
      })
      .catch(() => {
        /* non-critical */
      });
  }, [entityTypeId]);

  // Close views dropdown outside click
  useEffect(() => {
    function handle(e: MouseEvent): void {
      if (viewsRef.current && !viewsRef.current.contains(e.target as Node))
        setViewsOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  async function handleSaveView(): Promise<void> {
    if (!entityTypeId || !newViewName.trim()) return;
    setSavingView(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/saved-views`, {
        method: "POST",
        body: JSON.stringify({
          entityTypeId,
          name: newViewName.trim(),
          filterConfig: { search },
          sortConfig: {},
          isDefault: newViewDefault,
        }),
      });
      const created = (res as { data?: SavedView }).data;
      if (created) setSavedViews((prev) => [...prev, created]);
      setShowSaveModal(false);
      setNewViewName("");
      setNewViewDefault(false);
    } catch {
      /* ignore */
    } finally {
      setSavingView(false);
    }
  }

  async function handleExport(format: "csv" | "xlsx"): Promise<void> {
    if (!entityTypeId || exportLoading) return;
    setExportLoading(true);
    setExportError(null);
    try {
      const res = await fetchWithAuth(
        `${API_URL}/entity-types/${entityTypeId}/export?format=${format}`,
      );
      if (
        res &&
        typeof res === "object" &&
        "error" in (res as Record<string, unknown>)
      ) {
        const err = res as { error: string; message?: string };
        setExportError(err.message ?? err.error);
        return;
      }
      const link = exportLinkRef.current;
      if (link) {
        link.href = res as string;
        link.download = `export.${format}`;
        link.click();
      }
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExportLoading(false);
    }
  }

  const visibleFields = fields.slice(0, 4);
  const slug = typeSlug ?? "";
  const typeName = entityType?.plural ?? "Records";

  const filtered = search.trim()
    ? records.filter((r) => {
        const q = search.toLowerCase();
        return (
          (r.currentState ?? "").toLowerCase().includes(q) ||
          Object.values(r.fields).some((v) =>
            String(v ?? "")
              .toLowerCase()
              .includes(q),
          )
        );
      })
    : records;

  if (!entityType && !loading) {
    return (
      <div className="portal-page">
        <div className="portal-alert-error">Entity type not found.</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="portal-loading">
        <div className="spinner" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="portal-page">
        <div className="portal-alert-error">{error}</div>
      </div>
    );
  }

  return (
    <div className="portal-page">
      {/* ── Page header ── */}
      <div className="rl-page-header">
        <div className="rl-header-left">
          <div className="rl-header-accent" />
          <div>
            <h1 className="rl-title">
              {entityType?.icon && (
                <span className="rl-title-icon">{entityType.icon}</span>
              )}
              {typeName}
            </h1>
            <p className="rl-subtitle">
              {records.length} {records.length === 1 ? "record" : "records"}{" "}
              total
            </p>
          </div>
        </div>
        <Link to={`/${slug}/new`} className="rl-btn-new">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New {entityType?.name ?? "Record"}
        </Link>
      </div>

      {/* Hidden download anchor */}
      <a ref={exportLinkRef} style={{ display: "none" }} />

      {/* ── Toolbar ── */}
      <div className="rl-toolbar">
        <div className="rl-search-wrap">
          <svg
            className="rl-search-icon"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="rl-search"
            type="search"
            placeholder={`Search ${typeName.toLowerCase()}…`}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setActiveViewId(null);
            }}
          />
        </div>
        {search && (
          <span className="rl-filter-count">
            {filtered.length} of {records.length}
          </span>
        )}

        {/* T21: Views dropdown */}
        <div
          ref={viewsRef}
          style={{ position: "relative", marginLeft: "auto" }}
        >
          <button
            className="rl-views-btn"
            onClick={() => setViewsOpen((o) => !o)}
          >
            {activeViewId
              ? (savedViews.find((v) => v.id === activeViewId)?.name ?? "Views")
              : "Views"}
            <span style={{ fontSize: "9px", marginLeft: "4px" }}>▾</span>
          </button>
          {viewsOpen && (
            <div className="rl-views-dropdown">
              <div
                className="rl-views-item"
                onClick={() => {
                  setActiveViewId(null);
                  setSearch("");
                  setViewsOpen(false);
                }}
              >
                <span
                  style={{ fontStyle: "italic", color: "var(--muted, #888)" }}
                >
                  Default (no filter)
                </span>
              </div>
              {savedViews.map((v) => (
                <div
                  key={v.id}
                  className={`rl-views-item${activeViewId === v.id ? " rl-views-item--active" : ""}`}
                  onClick={() => {
                    setActiveViewId(v.id);
                    setSearch(v.filterConfig?.search ?? "");
                    setViewsOpen(false);
                  }}
                >
                  {v.name}
                  {v.isDefault && (
                    <span
                      style={{
                        fontSize: "9px",
                        marginLeft: "4px",
                        color: "var(--accent, #6366f1)",
                      }}
                    >
                      default
                    </span>
                  )}
                </div>
              ))}
              <div
                style={{
                  height: "1px",
                  background: "#e5e7eb",
                  margin: "2px 0",
                }}
              />
              <div
                className="rl-views-item rl-views-item--action"
                onClick={() => {
                  setViewsOpen(false);
                  setNewViewName("");
                  setNewViewDefault(false);
                  setShowSaveModal(true);
                }}
              >
                + Save current view
              </div>
            </div>
          )}
        </div>

        {/* T21: Export split-button */}
        <div style={{ display: "flex" }}>
          <button
            className="rl-export-btn"
            onClick={() => void handleExport("csv")}
            disabled={exportLoading}
          >
            {exportLoading ? "Exporting…" : "↓ Export"}
          </button>
          <button
            className="rl-export-btn-arrow"
            onClick={() => void handleExport("xlsx")}
            disabled={exportLoading}
            title="Download Excel"
          >
            xlsx
          </button>
        </div>
      </div>

      {/* T21: Export error */}
      {exportError && (
        <div
          style={{
            margin: "0 0 12px",
            padding: "10px 14px",
            background: "#fef2f2",
            color: "#dc2626",
            border: "1px solid #fca5a5",
            borderRadius: "6px",
            fontSize: "13px",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>⚠ Export failed: {exportError}</span>
          <button
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "inherit",
              fontSize: "16px",
            }}
            onClick={() => setExportError(null)}
          >
            ×
          </button>
        </div>
      )}

      {/* ── Table / empty ── */}
      {records.length === 0 ? (
        <div className="rl-empty">
          <div className="rl-empty-icon">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <p className="rl-empty-title">No {typeName.toLowerCase()} yet</p>
          <p className="rl-empty-sub">Create your first one to get started.</p>
          <Link
            to={`/${slug}/new`}
            className="rl-btn-new"
            style={{ marginTop: "16px" }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Create {entityType?.name ?? "Record"}
          </Link>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rl-empty">
          <p className="rl-empty-title">No results for "{search}"</p>
          <p className="rl-empty-sub">Try a different search term.</p>
        </div>
      ) : (
        <div className="rl-table-card">
          <table className="rl-table">
            <thead>
              <tr>
                <th>Status</th>
                {visibleFields.map((f) => (
                  <th key={f.id}>{f.label}</th>
                ))}
                <th>Created</th>
                <th style={{ width: "36px" }} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((rec) => (
                <tr
                  key={rec.id}
                  className="rl-row"
                  onClick={() => navigate(`/${slug}/${rec.id}`)}
                >
                  <td>
                    <StateChip state={rec.currentState} />
                  </td>
                  {visibleFields.map((f) => (
                    <td key={f.id} className="rl-cell">
                      {fieldDisplay(rec.fields[f.name], f.fieldType)}
                    </td>
                  ))}
                  <td className="rl-date">
                    {new Date(rec.createdAt).toLocaleDateString()}
                  </td>
                  <td>
                    <button
                      className="rl-arrow-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/${slug}/${rec.id}`);
                      }}
                      aria-label="Open record"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* T21: Save view modal */}
      {showSaveModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1200,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowSaveModal(false);
          }}
        >
          <div
            style={{
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: "14px",
              padding: "24px 28px",
              width: "100%",
              maxWidth: "360px",
              boxShadow: "0 20px 60px rgba(0,0,0,.18)",
            }}
          >
            <p
              style={{ margin: "0 0 16px", fontWeight: 600, fontSize: "15px" }}
            >
              Save view
            </p>
            <div style={{ marginBottom: "12px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "12px",
                  fontWeight: 500,
                  marginBottom: "5px",
                  color: "#6b7280",
                }}
              >
                View name *
              </label>
              <input
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  border: "1px solid #d1d5db",
                  borderRadius: "6px",
                  fontSize: "13px",
                  boxSizing: "border-box",
                }}
                placeholder="e.g. My open tickets"
                value={newViewName}
                onChange={(e) => setNewViewName(e.target.value)}
                autoFocus
              />
            </div>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "13px",
                marginBottom: "20px",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={newViewDefault}
                onChange={(e) => setNewViewDefault(e.target.checked)}
              />
              Set as default view
            </label>
            <div
              style={{
                display: "flex",
                gap: "10px",
                justifyContent: "flex-end",
              }}
            >
              <button
                style={{
                  padding: "7px 14px",
                  borderRadius: "6px",
                  border: "1px solid #d1d5db",
                  background: "#f9fafb",
                  cursor: "pointer",
                  fontSize: "13px",
                }}
                onClick={() => setShowSaveModal(false)}
                disabled={savingView}
              >
                Cancel
              </button>
              <button
                style={{
                  padding: "7px 16px",
                  borderRadius: "6px",
                  border: "none",
                  background: "#6366f1",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: "13px",
                  opacity: savingView || !newViewName.trim() ? 0.5 : 1,
                }}
                onClick={() => void handleSaveView()}
                disabled={savingView || !newViewName.trim()}
              >
                {savingView ? "Saving…" : "Save view"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .rl-views-btn {
          display: inline-flex; align-items: center; font-size: 12px;
          font-weight: 500; padding: 6px 10px; border-radius: 6px;
          background: #f3f4f6; color: #374151;
          border: 1px solid #d1d5db; cursor: pointer;
          white-space: nowrap;
        }
        .rl-views-btn:hover { background: #e5e7eb; }
        .rl-views-dropdown {
          position: absolute; top: calc(100% + 4px); right: 0;
          width: 200px; background: #fff;
          border: 1px solid #d1d5db; border-radius: 10px;
          box-shadow: 0 10px 40px rgba(0,0,0,.12); z-index: 300; overflow: hidden;
        }
        .rl-views-item {
          padding: 9px 14px; font-size: 13px; cursor: pointer; color: #374151;
          transition: background 0.1s;
        }
        .rl-views-item:hover { background: #f3f4f6; }
        .rl-views-item--active { color: #6366f1; font-weight: 600; }
        .rl-views-item--action { color: #6366f1; font-weight: 500; }
        .rl-export-btn {
          font-size: 12px; font-weight: 500; padding: 6px 10px;
          border-radius: 6px 0 0 6px; background: #f3f4f6; color: #374151;
          border: 1px solid #d1d5db; cursor: pointer; white-space: nowrap;
        }
        .rl-export-btn:hover:not(:disabled) { background: #e5e7eb; }
        .rl-export-btn:disabled { opacity: .5; cursor: not-allowed; }
        .rl-export-btn-arrow {
          font-size: 11px; font-weight: 500; padding: 6px 7px;
          border-radius: 0 6px 6px 0; background: #f3f4f6; color: #9ca3af;
          border: 1px solid #d1d5db; border-left: none; cursor: pointer;
        }
        .rl-export-btn-arrow:hover:not(:disabled) { background: #e5e7eb; color: #374151; }
        .rl-export-btn-arrow:disabled { opacity: .5; cursor: not-allowed; }
      `}</style>
    </div>
  );
}
