import React, { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { fetchWithAuth, API_URL } from "../../lib/api.js";

type EntityField = {
  id: string;
  name: string;
  label: string;
  fieldType: string;
  isSystem: boolean;
  isRequired: boolean;
  config: {
    options?: Array<string | { label: string; value: string; color?: string }>;
  };
};

type EntityInstance = {
  id: string;
  currentState: string | null;
  fields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  assignedTo: string | null;
};

type EntityType = {
  id: string;
  name: string;
  plural: string;
};

export function EntityInstances(): React.ReactElement {
  const { id: entityTypeId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [entityType, setEntityType] = useState<EntityType | null>(null);
  const [fields, setFields] = useState<EntityField[]>([]);
  const [instances, setInstances] = useState<EntityInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entityTypeId) return;
    setLoading(true);
    Promise.all([
      fetchWithAuth(`${API_URL}/entity-types/${entityTypeId}`),
      fetchWithAuth(`${API_URL}/entity-types/${entityTypeId}/fields`),
      fetchWithAuth(`${API_URL}/entities?entityTypeId=${entityTypeId}`),
    ])
      .then(([etRes, fieldsRes, instRes]) => {
        setEntityType((etRes as { data: EntityType }).data);
        setFields(
          ((fieldsRes as { data?: EntityField[] }).data ?? [])
            .filter((f) => !f.isSystem)
            .slice(0, 4),
        );
        setInstances((instRes as { data?: EntityInstance[] }).data ?? []);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load"),
      )
      .finally(() => setLoading(false));
  }, [entityTypeId]);

  function stateBadge(state: string | null): React.ReactElement {
    if (!state) return <span style={{ color: "var(--text-muted)" }}>—</span>;
    const colors: Record<string, string> = {
      new: "#6b7280",
      open: "#3b82f6",
      in_progress: "#f59e0b",
      waiting_for_customer: "#8b5cf6",
      resolved: "#10b981",
      closed: "#6b7280",
      pending: "#8b5cf6",
    };
    const color = colors[state] ?? "#6b7280";
    return (
      <span
        style={{
          display: "inline-block",
          padding: "2px 10px",
          borderRadius: "4px",
          fontSize: "11px",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.4px",
          background: `${color}22`,
          color,
          border: `1px solid ${color}44`,
        }}
      >
        {state.replace(/_/g, " ")}
      </span>
    );
  }

  if (loading) {
    return (
      <div className="loading-center">
        <div className="spinner" />
        <span className="loader-text">Loading records…</span>
      </div>
    );
  }

  if (error) {
    return <div className="alert alert-error">{error}</div>;
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "28px",
        }}
      >
        <div>
          <div style={{ marginBottom: "8px" }}>
            <Link
              to={`/entity-types/${entityTypeId ?? ""}`}
              className="breadcrumb-link"
            >
              ← {entityType?.name ?? "Entity Type"}
            </Link>
          </div>
          <h2 className="page-title">{entityType?.plural ?? "Records"}</h2>
          <p className="page-subtitle">
            All instances of {entityType?.name ?? "this entity type"}.
          </p>
        </div>
        <div className="stat-pill">{instances.length} records</div>
      </div>

      {instances.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">◻</div>
          <h4>No records yet</h4>
          <p>Records created via the portal will appear here.</p>
        </div>
      ) : (
        <div className="data-panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                {fields.map((f) => (
                  <th key={f.id}>{f.label}</th>
                ))}
                <th>Status</th>
                <th>Created</th>
                <th style={{ width: "40px" }} />
              </tr>
            </thead>
            <tbody>
              {instances.map((inst) => (
                <tr
                  key={inst.id}
                  className="table-row-clickable"
                  onClick={() =>
                    navigate(
                      `/entity-types/${entityTypeId ?? ""}/records/${inst.id}`,
                    )
                  }
                >
                  <td
                    style={{
                      color: "var(--text-muted)",
                      fontSize: "12px",
                      fontFamily: "monospace",
                    }}
                  >
                    {inst.id.slice(0, 8)}…
                  </td>
                  {fields.map((f) => (
                    <td
                      key={f.id}
                      style={{
                        maxWidth: "200px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {inst.fields[f.name] === null ||
                      inst.fields[f.name] === undefined ? (
                        <span style={{ color: "var(--text-muted)" }}>—</span>
                      ) : (
                        String(inst.fields[f.name])
                      )}
                    </td>
                  ))}
                  <td>{stateBadge(inst.currentState)}</td>
                  <td style={{ color: "var(--text-muted)", fontSize: "13px" }}>
                    {new Date(inst.createdAt).toLocaleDateString()}
                  </td>
                  <td>
                    <button
                      className="btn-icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(
                          `/entity-types/${entityTypeId ?? ""}/records/${inst.id}`,
                        );
                      }}
                    >
                      →
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
