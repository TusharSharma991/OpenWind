import React, { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { fetchWithAuth, API_URL } from "../../lib/api.js";

type WorkflowState = { name: string; label: string; color: string | null };

type WorkflowFull = {
  id: string;
  name: string;
  entityTypeId: string;
  initialState: string;
  states: WorkflowState[];
  transitions: { id: string }[];
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

export function WorkflowRecords(): React.ReactElement {
  const { workflowId } = useParams<{ workflowId: string }>();
  const navigate = useNavigate();

  const [workflow, setWorkflow] = useState<WorkflowFull | null>(null);
  const [fields, setFields] = useState<EntityField[]>([]);
  const [records, setRecords] = useState<EntityInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterState, setFilterState] = useState<string>("");

  useEffect(() => {
    if (!workflowId) return;
    setLoading(true);

    fetchWithAuth(`${API_URL}/workflows/${workflowId}`)
      .then(async (wfRes) => {
        const wf = (wfRes as { data: WorkflowFull }).data;
        setWorkflow(wf);

        const [fieldsRes, recRes] = await Promise.all([
          fetchWithAuth(`${API_URL}/entity-types/${wf.entityTypeId}/fields`),
          fetchWithAuth(`${API_URL}/entities?entityTypeId=${wf.entityTypeId}`),
        ]);
        setFields(
          (fieldsRes as { data: EntityField[] }).data.filter(
            (f) => !f.isSystem,
          ),
        );
        setRecords((recRes as { data?: EntityInstance[] }).data ?? []);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load"),
      )
      .finally(() => setLoading(false));
  }, [workflowId]);

  if (loading) {
    return (
      <div className="loading-center">
        <div className="spinner" />
        <span className="loader-text">Loading records…</span>
      </div>
    );
  }

  if (error || !workflow) {
    return (
      <div className="empty-state">
        <div className="empty-icon">⚠</div>
        <h4>{error ?? "Workflow not found"}</h4>
        <Link
          to="/records"
          className="back-link"
          style={{ marginTop: "12px", display: "inline-block" }}
        >
          ← Records
        </Link>
      </div>
    );
  }

  const stateMap = new Map(workflow.states.map((s) => [s.name, s]));
  const visibleFields = fields.slice(0, 4);
  const filtered = filterState
    ? records.filter((r) => r.currentState === filterState)
    : records;

  const stateCounts = workflow.states.map((s) => ({
    ...s,
    count: records.filter((r) => r.currentState === s.name).length,
  }));

  return (
    <div>
      <Link to="/records" className="back-link">
        ← Records
      </Link>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          margin: "16px 0 24px",
        }}
      >
        <div>
          <h2 className="page-title">{workflow.name}</h2>
          <p className="page-subtitle">{records.length} total records</p>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            className="btn-secondary btn-sm"
            onClick={() => navigate(`/workflows/${workflow.id}`)}
          >
            ⚙ Workflow Settings
          </button>
        </div>
      </div>

      {/* State summary bar */}
      <div
        style={{
          display: "flex",
          gap: "10px",
          marginBottom: "24px",
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={() => setFilterState("")}
          style={{
            padding: "6px 14px",
            borderRadius: "20px",
            fontSize: "12px",
            fontWeight: 600,
            border: `2px solid ${!filterState ? "var(--accent-primary)" : "var(--border-color)"}`,
            background: !filterState ? "hsla(250,84%,60%,.1)" : "transparent",
            color: !filterState ? "var(--accent-primary)" : "var(--text-muted)",
            cursor: "pointer",
            transition: "all .15s",
          }}
        >
          All ({records.length})
        </button>
        {stateCounts.map((s) => (
          <button
            key={s.name}
            onClick={() => setFilterState(s.name === filterState ? "" : s.name)}
            style={{
              padding: "6px 14px",
              borderRadius: "20px",
              fontSize: "12px",
              fontWeight: 600,
              border: `2px solid ${filterState === s.name ? (s.color ?? "var(--accent-primary)") : "var(--border-color)"}`,
              background:
                filterState === s.name
                  ? `${s.color ?? "var(--accent-primary)"}18`
                  : "transparent",
              color:
                filterState === s.name
                  ? (s.color ?? "var(--accent-primary)")
                  : "var(--text-muted)",
              cursor: "pointer",
              transition: "all .15s",
            }}
          >
            {s.label} ({s.count})
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📋</div>
          <h4>
            No records
            {filterState
              ? ` in "${stateMap.get(filterState)?.label ?? filterState}"`
              : ""}
          </h4>
          <p>Records created through the portal will appear here.</p>
        </div>
      ) : (
        <div className="data-panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>State</th>
                {visibleFields.map((f) => (
                  <th key={f.id}>{f.label}</th>
                ))}
                <th>Created</th>
                <th style={{ width: "40px" }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((rec) => {
                const state = rec.currentState
                  ? stateMap.get(rec.currentState)
                  : null;
                return (
                  <tr
                    key={rec.id}
                    className="table-row-clickable"
                    onClick={() =>
                      navigate(
                        `/entity-types/${workflow.entityTypeId}/records/${rec.id}`,
                      )
                    }
                  >
                    <td>
                      {state ? (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "5px",
                            padding: "3px 10px",
                            borderRadius: "20px",
                            fontSize: "12px",
                            fontWeight: 600,
                            background: state.color
                              ? `${state.color}18`
                              : "var(--bg-tertiary)",
                            color: state.color ?? "var(--text-muted)",
                            border: `1px solid ${state.color ? `${state.color}44` : "var(--border-color)"}`,
                          }}
                        >
                          <span
                            style={{
                              width: "6px",
                              height: "6px",
                              borderRadius: "50%",
                              background: state.color ?? "var(--text-muted)",
                            }}
                          />
                          {state.label}
                        </span>
                      ) : (
                        <span className="text-muted-sm">—</span>
                      )}
                    </td>
                    {visibleFields.map((f) => (
                      <td key={f.id} style={{ fontSize: "13px" }}>
                        {fieldDisplay(rec.fields[f.name], f.fieldType)}
                      </td>
                    ))}
                    <td
                      style={{ color: "var(--text-muted)", fontSize: "12px" }}
                    >
                      {new Date(rec.createdAt).toLocaleDateString()}
                    </td>
                    <td>
                      <button
                        className="btn-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(
                            `/entity-types/${workflow.entityTypeId}/records/${rec.id}`,
                          );
                        }}
                      >
                        →
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
