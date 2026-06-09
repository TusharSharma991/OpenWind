import React, { useState } from "react";
import { useOne, useList } from "@refinedev/core";
import { useParams, Link } from "react-router-dom";
import { fetchWithAuth, API_URL } from "../../lib/api.js";

type EntityType = { id: string; name: string };

type WorkflowState = {
  id: string;
  name: string;
  label: string;
  color: string | null;
  isTerminal: boolean;
  slaHours: number | null;
  sortOrder: number;
};

type WorkflowTransition = {
  id: string;
  fromState: string;
  toState: string;
  label: string;
  allowedRoles: string[];
  requiresComment: boolean;
  requiresFields: string[];
};

type WorkflowFull = {
  id: string;
  name: string;
  entityTypeId: string;
  initialState: string;
  createdAt: string;
  states: WorkflowState[];
  transitions: WorkflowTransition[];
};

type AddStateForm = {
  name: string;
  label: string;
  color: string;
  isTerminal: boolean;
  slaHours: string;
  sortOrder: string;
};

type AddTransitionForm = {
  fromState: string;
  toState: string;
  label: string;
  allowedRoles: string;
  requiresComment: boolean;
};

const EMPTY_STATE: AddStateForm = {
  name: "",
  label: "",
  color: "#6366f1",
  isTerminal: false,
  slaHours: "",
  sortOrder: "0",
};

const EMPTY_TRANSITION: AddTransitionForm = {
  fromState: "",
  toState: "",
  label: "",
  allowedRoles: "",
  requiresComment: false,
};

function StateDot({ color }: { color: string | null }): React.ReactElement {
  return (
    <span
      className="state-dot"
      style={{ backgroundColor: color ?? "var(--accent-primary)" }}
    />
  );
}

function StateFlowDiagram({
  states,
  initialState,
}: {
  states: WorkflowState[];
  transitions: WorkflowTransition[];
  initialState: string;
}): React.ReactElement {
  const sorted = [...states].sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <div className="state-flow">
      {sorted.map((state, i) => {
        const isLast = i === sorted.length - 1;
        return (
          <React.Fragment key={state.id}>
            <div
              className={[
                "state-flow-node",
                state.name === initialState ? "state-flow-node--initial" : "",
                state.isTerminal ? "state-flow-node--terminal" : "",
              ].join(" ")}
              style={state.color ? { borderColor: state.color } : {}}
            >
              <StateDot color={state.color} />
              <span className="state-flow-label">{state.label}</span>
              <div className="state-flow-badges">
                {state.name === initialState && (
                  <span
                    className="badge badge-primary"
                    style={{ fontSize: "9px", padding: "2px 5px" }}
                  >
                    start
                  </span>
                )}
                {state.isTerminal && (
                  <span
                    className="badge badge-muted"
                    style={{ fontSize: "9px", padding: "2px 5px" }}
                  >
                    end
                  </span>
                )}
                {state.slaHours !== null && (
                  <span
                    className="badge badge-warning"
                    style={{ fontSize: "9px", padding: "2px 5px" }}
                  >
                    SLA {state.slaHours}h
                  </span>
                )}
              </div>
            </div>
            {!isLast && <span className="flow-arrow">→</span>}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export function WorkflowDetail(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, refetch } = useOne<WorkflowFull>({
    resource: "workflows",
    id: id ?? "missing",
  });
  const { data: etData } = useList<EntityType>({ resource: "entity-types" });
  const entityTypes = etData?.data ?? [];

  const [showAddState, setShowAddState] = useState(false);
  const [stateForm, setStateForm] = useState<AddStateForm>(EMPTY_STATE);
  const [savingState, setSavingState] = useState(false);
  const [stateError, setStateError] = useState<string | null>(null);
  const [deletingStateId, setDeletingStateId] = useState<string | null>(null);

  const [showAddTransition, setShowAddTransition] = useState(false);
  const [transForm, setTransForm] =
    useState<AddTransitionForm>(EMPTY_TRANSITION);
  const [savingTrans, setSavingTrans] = useState(false);
  const [transError, setTransError] = useState<string | null>(null);
  const [deletingTransId, setDeletingTransId] = useState<string | null>(null);

  async function handleAddState(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!id) return;
    setSavingState(true);
    setStateError(null);
    try {
      await fetchWithAuth(`${API_URL}/workflows/${id}/states`, {
        method: "POST",
        body: JSON.stringify({
          name: stateForm.name.trim(),
          label: stateForm.label.trim(),
          color: stateForm.color || undefined,
          isTerminal: stateForm.isTerminal,
          slaHours: stateForm.slaHours ? parseInt(stateForm.slaHours) : null,
          sortOrder: parseInt(stateForm.sortOrder) || 0,
        }),
      });
      setShowAddState(false);
      setStateForm(EMPTY_STATE);
      void refetch();
    } catch (err) {
      setStateError(err instanceof Error ? err.message : "Failed to add state");
    } finally {
      setSavingState(false);
    }
  }

  async function handleDeleteState(stateId: string): Promise<void> {
    if (!id) return;
    setDeletingStateId(stateId);
    try {
      await fetchWithAuth(`${API_URL}/workflows/${id}/states/${stateId}`, {
        method: "DELETE",
      });
      void refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete state");
    } finally {
      setDeletingStateId(null);
    }
  }

  async function handleAddTransition(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!id) return;
    setSavingTrans(true);
    setTransError(null);
    try {
      const allowedRoles = transForm.allowedRoles
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean);
      await fetchWithAuth(`${API_URL}/workflows/${id}/transitions`, {
        method: "POST",
        body: JSON.stringify({
          fromState: transForm.fromState.trim(),
          toState: transForm.toState.trim(),
          label: transForm.label.trim() || undefined,
          allowedRoles: allowedRoles.length > 0 ? allowedRoles : undefined,
          requiresComment: transForm.requiresComment,
        }),
      });
      setShowAddTransition(false);
      setTransForm(EMPTY_TRANSITION);
      void refetch();
    } catch (err) {
      setTransError(
        err instanceof Error ? err.message : "Failed to add transition",
      );
    } finally {
      setSavingTrans(false);
    }
  }

  async function handleDeleteTransition(transId: string): Promise<void> {
    if (!id) return;
    setDeletingTransId(transId);
    try {
      await fetchWithAuth(`${API_URL}/workflows/${id}/transitions/${transId}`, {
        method: "DELETE",
      });
      void refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete transition");
    } finally {
      setDeletingTransId(null);
    }
  }

  const workflow = data?.data;
  const etMap = new Map(entityTypes.map((e) => [e.id, e.name]));

  if (isLoading) {
    return (
      <div className="loading-center">
        <div className="spinner" />
        <span className="loader-text">Loading workflow…</span>
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="empty-state">
        <h4>Workflow not found</h4>
        <Link
          to="/workflows"
          className="back-link"
          style={{ marginTop: "12px", display: "inline-block" }}
        >
          ← Back to Workflows
        </Link>
      </div>
    );
  }

  const sortedStates = [...workflow.states].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
  const stateNames = sortedStates.map((s) => s.name);

  return (
    <div>
      <Link to="/workflows" className="back-link">
        ← Workflows
      </Link>

      <div className="detail-header">
        <div className="workflow-icon workflow-icon-lg">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="2"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 8.689c0-.864.933-1.406 1.683-.977l7.108 4.061a1.125 1.125 0 010 1.954l-7.108 4.061A1.125 1.125 0 013 16.811V8.69zM12.75 8.689c0-.864.933-1.406 1.683-.977l7.108 4.061a1.125 1.125 0 010 1.954l-7.108 4.061a1.125 1.125 0 01-1.683-.977V8.69z"
            />
          </svg>
        </div>
        <div>
          <h2 className="page-title" style={{ marginBottom: "6px" }}>
            {workflow.name}
          </h2>
          <div
            style={{
              display: "flex",
              gap: "8px",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <span className="badge badge-primary">
              {etMap.get(workflow.entityTypeId) ??
                workflow.entityTypeId.slice(0, 8) + "…"}
            </span>
            <span style={{ color: "var(--text-muted)", fontSize: "13px" }}>
              {workflow.states.length} states · {workflow.transitions.length}{" "}
              transitions
            </span>
            <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>
              Created {new Date(workflow.createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>
      </div>

      {/* State flow diagram */}
      <div className="data-panel" style={{ marginBottom: "24px" }}>
        <div className="panel-header">
          <h3 className="panel-title">State Flow</h3>
          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            initial → … → terminal
          </span>
        </div>
        <StateFlowDiagram
          states={workflow.states}
          transitions={workflow.transitions}
          initialState={workflow.initialState}
        />
      </div>

      {/* States table */}
      <div className="data-panel" style={{ marginBottom: "24px" }}>
        <div className="panel-header">
          <h3 className="panel-title">States</h3>
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <span className="badge badge-muted">{workflow.states.length}</span>
            <button
              className="btn-primary btn-sm"
              onClick={() => setShowAddState(true)}
            >
              + Add State
            </button>
          </div>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>State</th>
              <th>Label</th>
              <th>Type</th>
              <th>SLA</th>
              <th style={{ width: "48px" }}></th>
            </tr>
          </thead>
          <tbody>
            {sortedStates.map((state) => (
              <tr key={state.id}>
                <td>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <StateDot color={state.color} />
                    <code className="code-inline">{state.name}</code>
                    {state.name === workflow.initialState && (
                      <span
                        className="badge badge-primary"
                        style={{ fontSize: "10px" }}
                      >
                        initial
                      </span>
                    )}
                  </div>
                </td>
                <td style={{ fontWeight: 500 }}>{state.label}</td>
                <td>
                  {state.isTerminal ? (
                    <span className="badge badge-muted">Terminal</span>
                  ) : state.name === workflow.initialState ? (
                    <span className="badge badge-primary">Initial</span>
                  ) : (
                    <span className="badge badge-success">Active</span>
                  )}
                </td>
                <td style={{ fontSize: "13px" }}>
                  {state.slaHours !== null ? (
                    <span style={{ color: "var(--warning)", fontWeight: 500 }}>
                      {state.slaHours}h
                    </span>
                  ) : (
                    <span className="text-muted-sm">—</span>
                  )}
                </td>
                <td>
                  {state.name !== workflow.initialState && (
                    <button
                      className="btn-danger-sm"
                      disabled={deletingStateId === state.id}
                      onClick={() => {
                        if (confirm(`Delete state "${state.label}"?`))
                          void handleDeleteState(state.id);
                      }}
                      title="Delete state"
                    >
                      {deletingStateId === state.id ? "…" : "✕"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Transitions table */}
      <div className="data-panel">
        <div className="panel-header">
          <h3 className="panel-title">Transitions</h3>
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <span className="badge badge-muted">
              {workflow.transitions.length}
            </span>
            <button
              className="btn-primary btn-sm"
              onClick={() => setShowAddTransition(true)}
            >
              + Add Transition
            </button>
          </div>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>From</th>
              <th style={{ width: "28px" }}></th>
              <th>To</th>
              <th>Label</th>
              <th>Allowed Roles</th>
              <th>Requirements</th>
              <th style={{ width: "48px" }}></th>
            </tr>
          </thead>
          <tbody>
            {workflow.transitions.map((t) => (
              <tr key={t.id}>
                <td>
                  <code className="code-inline">{t.fromState}</code>
                </td>
                <td
                  style={{
                    color: "var(--text-muted)",
                    fontWeight: 700,
                    textAlign: "center",
                  }}
                >
                  →
                </td>
                <td>
                  <code className="code-inline">{t.toState}</code>
                </td>
                <td style={{ fontWeight: 500 }}>{t.label}</td>
                <td>
                  {t.allowedRoles.length === 0 ? (
                    <span className="text-muted-sm">Any</span>
                  ) : (
                    <div
                      style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}
                    >
                      {t.allowedRoles.map((r) => (
                        <span key={r} className="badge badge-primary">
                          {r}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td>
                  {!t.requiresComment && t.requiresFields.length === 0 ? (
                    <span className="text-muted-sm">—</span>
                  ) : (
                    <div
                      style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}
                    >
                      {t.requiresComment && (
                        <span className="badge badge-warning">Comment</span>
                      )}
                      {t.requiresFields.length > 0 && (
                        <span className="badge badge-warning">
                          {t.requiresFields.length} field
                          {t.requiresFields.length > 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  )}
                </td>
                <td>
                  <button
                    className="btn-danger-sm"
                    disabled={deletingTransId === t.id}
                    onClick={() => {
                      if (
                        confirm(
                          `Delete transition "${t.label || `${t.fromState} → ${t.toState}`}"?`,
                        )
                      )
                        void handleDeleteTransition(t.id);
                    }}
                    title="Delete transition"
                  >
                    {deletingTransId === t.id ? "…" : "✕"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add State modal */}
      {showAddState && (
        <div className="modal-overlay" onClick={() => setShowAddState(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Add State</h3>
              <button
                className="modal-close"
                onClick={() => setShowAddState(false)}
              >
                ×
              </button>
            </div>
            <form onSubmit={(e) => void handleAddState(e)}>
              <div className="modal-body">
                {stateError && (
                  <div
                    className="alert alert-error"
                    style={{ marginBottom: "16px" }}
                  >
                    {stateError}
                  </div>
                )}
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Label *</label>
                    <input
                      className="form-input"
                      placeholder="e.g. In Progress"
                      value={stateForm.label}
                      onChange={(e) => {
                        const label = e.target.value;
                        const name = label
                          .toLowerCase()
                          .replace(/\s+/g, "_")
                          .replace(/[^a-z0-9_]/g, "");
                        setStateForm((f) => ({ ...f, label, name }));
                      }}
                      required
                      autoFocus
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">State Name *</label>
                    <input
                      className="form-input"
                      placeholder="e.g. in_progress"
                      value={stateForm.name}
                      onChange={(e) =>
                        setStateForm((f) => ({ ...f, name: e.target.value }))
                      }
                      pattern="^[a-z_][a-z0-9_]*$"
                      title="snake_case only"
                      required
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Color</label>
                    <div
                      style={{
                        display: "flex",
                        gap: "8px",
                        alignItems: "center",
                      }}
                    >
                      <input
                        type="color"
                        value={stateForm.color}
                        onChange={(e) =>
                          setStateForm((f) => ({ ...f, color: e.target.value }))
                        }
                        style={{
                          width: "40px",
                          height: "36px",
                          border: "none",
                          borderRadius: "6px",
                          cursor: "pointer",
                        }}
                      />
                      <input
                        className="form-input"
                        value={stateForm.color}
                        onChange={(e) =>
                          setStateForm((f) => ({ ...f, color: e.target.value }))
                        }
                        placeholder="#6366f1"
                        style={{ flex: 1 }}
                      />
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Sort Order</label>
                    <input
                      className="form-input"
                      type="number"
                      min={0}
                      value={stateForm.sortOrder}
                      onChange={(e) =>
                        setStateForm((f) => ({
                          ...f,
                          sortOrder: e.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">SLA Hours (optional)</label>
                  <input
                    className="form-input"
                    type="number"
                    min={1}
                    placeholder="e.g. 24"
                    value={stateForm.slaHours}
                    onChange={(e) =>
                      setStateForm((f) => ({ ...f, slaHours: e.target.value }))
                    }
                  />
                </div>
                <label className="form-checkbox">
                  <input
                    type="checkbox"
                    checked={stateForm.isTerminal}
                    onChange={(e) =>
                      setStateForm((f) => ({
                        ...f,
                        isTerminal: e.target.checked,
                      }))
                    }
                  />
                  <span>Terminal state (no outgoing transitions expected)</span>
                </label>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowAddState(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={savingState}
                >
                  {savingState ? "Adding…" : "Add State"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Transition modal */}
      {showAddTransition && (
        <div
          className="modal-overlay"
          onClick={() => setShowAddTransition(false)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Add Transition</h3>
              <button
                className="modal-close"
                onClick={() => setShowAddTransition(false)}
              >
                ×
              </button>
            </div>
            <form onSubmit={(e) => void handleAddTransition(e)}>
              <div className="modal-body">
                {transError && (
                  <div
                    className="alert alert-error"
                    style={{ marginBottom: "16px" }}
                  >
                    {transError}
                  </div>
                )}
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">From State *</label>
                    <select
                      className="form-input"
                      value={transForm.fromState}
                      onChange={(e) =>
                        setTransForm((f) => ({
                          ...f,
                          fromState: e.target.value,
                        }))
                      }
                      required
                    >
                      <option value="">Select…</option>
                      {stateNames.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">To State *</label>
                    <select
                      className="form-input"
                      value={transForm.toState}
                      onChange={(e) =>
                        setTransForm((f) => ({ ...f, toState: e.target.value }))
                      }
                      required
                    >
                      <option value="">Select…</option>
                      {stateNames.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Label</label>
                  <input
                    className="form-input"
                    placeholder="e.g. Start Work"
                    value={transForm.label}
                    onChange={(e) =>
                      setTransForm((f) => ({ ...f, label: e.target.value }))
                    }
                    autoFocus
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">
                    Allowed Roles (comma-separated, blank = any)
                  </label>
                  <input
                    className="form-input"
                    placeholder="e.g. admin, agent"
                    value={transForm.allowedRoles}
                    onChange={(e) =>
                      setTransForm((f) => ({
                        ...f,
                        allowedRoles: e.target.value,
                      }))
                    }
                  />
                </div>
                <label className="form-checkbox">
                  <input
                    type="checkbox"
                    checked={transForm.requiresComment}
                    onChange={(e) =>
                      setTransForm((f) => ({
                        ...f,
                        requiresComment: e.target.checked,
                      }))
                    }
                  />
                  <span>Requires comment</span>
                </label>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowAddTransition(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={savingTrans}
                >
                  {savingTrans ? "Adding…" : "Add Transition"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
