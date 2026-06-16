import React, { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { fetchWithAuth, API_URL } from "../../auth.js";
import { useEntityTypes } from "../../entity-type-context.js";

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
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {search && (
          <span className="rl-filter-count">
            {filtered.length} of {records.length}
          </span>
        )}
      </div>

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
    </div>
  );
}
