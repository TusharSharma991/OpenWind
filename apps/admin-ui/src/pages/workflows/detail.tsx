import React, { useCallback, useEffect, useState } from "react";
import { useOne } from "@refinedev/core";
import { useParams, Link, useNavigate } from "react-router-dom";
import { fetchWithAuth, API_URL } from "../../lib/api.js";
import { useEntityTypes, toTypeSlug } from "../../entity-type-context.js";

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
  isActive: boolean;
  createdAt: string;
  states: WorkflowState[];
  transitions: WorkflowTransition[];
};

type EntityField = {
  id: string;
  name: string;
  label: string;
  fieldType: string;
  isRequired: boolean;
  isIndexed: boolean;
  sortOrder: number;
};

type AddFieldForm = {
  name: string;
  label: string;
  fieldType: string;
  isRequired: boolean;
};

const EMPTY_FIELD: AddFieldForm = {
  name: "",
  label: "",
  fieldType: "text",
  isRequired: false,
};

const FIELD_TYPES = [
  { value: "text", label: "Text" },
  { value: "longtext", label: "Long Text" },
  { value: "number", label: "Number" },
  { value: "currency", label: "Currency" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Boolean" },
  { value: "enum", label: "Enum (select)" },
  { value: "email", label: "Email" },
  { value: "url", label: "URL" },
];

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

function ConfirmDeleteModal({
  message,
  onConfirm,
  onCancel,
  busy,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}): React.ReactElement {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1100,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        style={{
          background: "var(--bg-primary)",
          border: "1px solid var(--border-color)",
          borderRadius: "14px",
          padding: "24px 28px",
          width: "100%",
          maxWidth: "400px",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <div style={{ fontSize: "24px", marginBottom: "10px" }}>🗑</div>
        <p
          style={{
            margin: "0 0 6px",
            fontSize: "14px",
            color: "var(--text-primary)",
            fontWeight: 500,
          }}
        >
          {message}
        </p>
        <p
          style={{
            margin: "0 0 20px",
            fontSize: "12px",
            color: "var(--danger)",
          }}
        >
          This action cannot be undone.
        </p>
        <div
          style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}
        >
          <button
            className="btn btn-secondary"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            className="btn btn-danger-sm"
            onClick={onConfirm}
            disabled={busy}
            style={{ minWidth: "90px" }}
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

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
  const navigate = useNavigate();
  const { entityTypes } = useEntityTypes();
  const { data, isLoading, refetch } = useOne<WorkflowFull>({
    resource: "workflows",
    id: id ?? "missing",
  });

  const [fields, setFields] = useState<EntityField[]>([]);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [showAddField, setShowAddField] = useState(false);
  const [fieldForm, setFieldForm] = useState<AddFieldForm>(EMPTY_FIELD);
  const [savingField, setSavingField] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [deletingFieldId, setDeletingFieldId] = useState<string | null>(null);

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

  const [editingField, setEditingField] = useState<EntityField | null>(null);
  const [editingState, setEditingState] = useState<WorkflowState | null>(null);
  const [editingTransition, setEditingTransition] =
    useState<WorkflowTransition | null>(null);

  const [showDeleteWorkflow, setShowDeleteWorkflow] = useState(false);
  const [deletingWorkflow, setDeletingWorkflow] = useState(false);
  const [deleteWorkflowError, setDeleteWorkflowError] = useState<string | null>(
    null,
  );

  const [togglingActive, setTogglingActive] = useState(false);

  async function handleToggleActive(): Promise<void> {
    if (!id || !workflow) return;
    setTogglingActive(true);
    try {
      await fetchWithAuth(`${API_URL}/workflows/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !workflow.isActive }),
      });
      void refetch();
    } catch {
      // ignore — refetch will keep current state
    } finally {
      setTogglingActive(false);
    }
  }

  // Shared inline confirm modal for field/state/transition deletes
  const [confirmDelete, setConfirmDelete] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const fetchFields = useCallback((entityTypeId: string): void => {
    setFieldsLoading(true);
    fetchWithAuth(`${API_URL}/entity-types/${entityTypeId}/fields`)
      .then((res) => {
        setFields((res as { data?: EntityField[] }).data ?? []);
      })
      .catch(() => setFields([]))
      .finally(() => setFieldsLoading(false));
  }, []);

  const entityTypeId = data?.data.entityTypeId;
  useEffect(() => {
    if (entityTypeId) fetchFields(entityTypeId);
  }, [entityTypeId, fetchFields]);

  async function handleAddField(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!workflow?.entityTypeId) return;
    setSavingField(true);
    setFieldError(null);
    try {
      await fetchWithAuth(
        `${API_URL}/entity-types/${workflow.entityTypeId}/fields`,
        {
          method: "POST",
          body: JSON.stringify({
            name: fieldForm.name.trim(),
            label: fieldForm.label.trim(),
            fieldType: fieldForm.fieldType,
            isRequired: fieldForm.isRequired,
          }),
        },
      );
      setShowAddField(false);
      setFieldForm(EMPTY_FIELD);
      fetchFields(workflow.entityTypeId);
    } catch (err) {
      setFieldError(err instanceof Error ? err.message : "Failed to add field");
    } finally {
      setSavingField(false);
    }
  }

  async function handleDeleteField(fieldId: string): Promise<void> {
    if (!workflow?.entityTypeId) return;
    setDeletingFieldId(fieldId);
    try {
      await fetchWithAuth(
        `${API_URL}/entity-types/${workflow.entityTypeId}/fields/${fieldId}`,
        { method: "DELETE" },
      );
      fetchFields(workflow.entityTypeId);
    } catch (err) {
      setInlineError(
        err instanceof Error ? err.message : "Failed to delete field",
      );
    } finally {
      setDeletingFieldId(null);
    }
  }

  async function handleEditField(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!workflow?.entityTypeId || !editingField) return;
    setSavingField(true);
    setFieldError(null);
    try {
      await fetchWithAuth(
        `${API_URL}/entity-types/${workflow.entityTypeId}/fields/${editingField.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            label: fieldForm.label.trim(),
            isRequired: fieldForm.isRequired,
          }),
        },
      );
      setEditingField(null);
      setFieldForm(EMPTY_FIELD);
      fetchFields(workflow.entityTypeId);
    } catch (err) {
      setFieldError(
        err instanceof Error ? err.message : "Failed to edit field",
      );
    } finally {
      setSavingField(false);
    }
  }

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
      setInlineError(
        err instanceof Error ? err.message : "Failed to delete state",
      );
    } finally {
      setDeletingStateId(null);
    }
  }

  async function handleEditState(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!id || !editingState) return;
    setSavingState(true);
    setStateError(null);
    try {
      await fetchWithAuth(
        `${API_URL}/workflows/${id}/states/${editingState.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            label: stateForm.label.trim(),
            color: stateForm.color || undefined,
            isTerminal: stateForm.isTerminal,
            slaHours: stateForm.slaHours ? parseInt(stateForm.slaHours) : null,
            sortOrder: parseInt(stateForm.sortOrder) || 0,
          }),
        },
      );
      setEditingState(null);
      setStateForm(EMPTY_STATE);
      void refetch();
    } catch (err) {
      setStateError(
        err instanceof Error ? err.message : "Failed to edit state",
      );
    } finally {
      setSavingState(false);
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
      setInlineError(
        err instanceof Error ? err.message : "Failed to delete transition",
      );
    } finally {
      setDeletingTransId(null);
    }
  }

  async function handleEditTransition(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!id || !editingTransition) return;
    setSavingTrans(true);
    setTransError(null);
    try {
      const allowedRoles = transForm.allowedRoles
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean);
      await fetchWithAuth(
        `${API_URL}/workflows/${id}/transitions/${editingTransition.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            label: transForm.label.trim() || null,
            allowedRoles: allowedRoles.length > 0 ? allowedRoles : [],
            requiresComment: transForm.requiresComment,
          }),
        },
      );
      setEditingTransition(null);
      setTransForm(EMPTY_TRANSITION);
      void refetch();
    } catch (err) {
      setTransError(
        err instanceof Error ? err.message : "Failed to edit transition",
      );
    } finally {
      setSavingTrans(false);
    }
  }

  async function handleDeleteWorkflow(): Promise<void> {
    if (!id) return;
    setDeletingWorkflow(true);
    setDeleteWorkflowError(null);
    try {
      await fetchWithAuth(`${API_URL}/workflows/${id}`, { method: "DELETE" });
      navigate("/workflows");
    } catch (err) {
      setDeleteWorkflowError(
        err instanceof Error ? err.message : "Failed to delete workflow",
      );
      setDeletingWorkflow(false);
    }
  }

  const workflow = data?.data;

  const recordsSlug = (() => {
    if (!workflow) return null;
    const et = entityTypes.find((e) => e.id === workflow.entityTypeId);
    if (!et) return null;
    return toTypeSlug(et.plural || et.name);
  })();

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
      {/* Breadcrumb */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginBottom: "16px",
        }}
      >
        <Link to="/workflows" className="back-link" style={{ margin: 0 }}>
          ← Workflows
        </Link>
        <span style={{ color: "var(--text-muted)", fontSize: "13px" }}>/</span>
        <span
          style={{
            fontSize: "12px",
            fontWeight: 600,
            padding: "2px 10px",
            borderRadius: "20px",
            background: "hsla(250,84%,60%,.12)",
            color: "var(--accent-primary)",
            border: "1px solid hsla(250,84%,60%,.25)",
            letterSpacing: "0.3px",
          }}
        >
          Workflow Details
        </span>
      </div>

      {/* Page header card */}
      <div
        style={{
          background: "var(--bg-secondary)",
          border: "1px solid var(--border-color)",
          borderRadius: "16px",
          padding: "24px 28px",
          marginBottom: "24px",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "20px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: "16px" }}>
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
              <Link
                to={`/entity-types/${workflow.entityTypeId}`}
                className="badge badge-primary"
                style={{ textDecoration: "none" }}
              >
                Manage Fields ↗
              </Link>
              <span
                className={
                  workflow.isActive
                    ? "badge badge-success"
                    : "badge badge-muted"
                }
              >
                {workflow.isActive ? "Active" : "Inactive"}
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

        {/* Action buttons */}
        <div
          style={{
            display: "flex",
            gap: "10px",
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          {recordsSlug && (
            <button
              className="btn-primary"
              onClick={() => navigate(`/records/${recordsSlug}`)}
            >
              View Records →
            </button>
          )}
          <button
            className={workflow.isActive ? "btn btn-secondary" : "btn-primary"}
            onClick={() => void handleToggleActive()}
            disabled={togglingActive}
            style={{ minWidth: "110px" }}
          >
            {togglingActive
              ? "Saving…"
              : workflow.isActive
                ? "Deactivate"
                : "Activate"}
          </button>
          <button
            className="btn btn-danger-sm"
            onClick={() => setShowDeleteWorkflow(true)}
          >
            Delete Workflow
          </button>
        </div>
      </div>

      {inlineError && (
        <div
          className="alert alert-error"
          style={{
            marginBottom: "20px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>⚠ {inlineError}</span>
          <button
            onClick={() => setInlineError(null)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "16px",
              color: "inherit",
              padding: "0 4px",
            }}
          >
            ×
          </button>
        </div>
      )}

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

      {/* Fields panel */}
      <div className="data-panel" style={{ marginBottom: "24px" }}>
        <div className="panel-header">
          <h3 className="panel-title">Fields</h3>
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <span className="badge badge-muted">{fields.length}</span>
            <button
              className="btn-primary btn-sm"
              onClick={() => setShowAddField(true)}
            >
              + Add Field
            </button>
          </div>
        </div>
        {fieldsLoading ? (
          <div style={{ padding: "20px", textAlign: "center" }}>
            <div className="spinner" style={{ margin: "0 auto" }} />
          </div>
        ) : fields.length === 0 ? (
          <div
            className="empty-state"
            style={{ padding: "28px", fontSize: "13px" }}
          >
            <p>No fields yet. Add fields to capture data on records.</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Label</th>
                <th>Type</th>
                <th>Required</th>
                <th style={{ width: "80px" }}></th>
              </tr>
            </thead>
            <tbody>
              {[...fields]
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((f) => (
                  <tr key={f.id}>
                    <td>
                      <code className="code-inline">{f.name}</code>
                    </td>
                    <td style={{ fontWeight: 500 }}>{f.label}</td>
                    <td>
                      <span className="badge badge-muted">{f.fieldType}</span>
                    </td>
                    <td>
                      {f.isRequired ? (
                        <span className="badge badge-primary">Yes</span>
                      ) : (
                        <span className="text-muted-sm">—</span>
                      )}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button
                        className="btn-edit-sm"
                        style={{ marginRight: "6px" }}
                        onClick={() => {
                          setEditingField(f);
                          setFieldForm({
                            name: f.name,
                            label: f.label,
                            fieldType: f.fieldType,
                            isRequired: f.isRequired,
                          });
                          setFieldError(null);
                        }}
                        title="Edit field"
                      >
                        ✎
                      </button>
                      <button
                        className="btn-danger-sm"
                        disabled={deletingFieldId === f.id}
                        onClick={() =>
                          setConfirmDelete({
                            message: `Delete field "${f.label}"?`,
                            onConfirm: () => {
                              setConfirmDelete(null);
                              void handleDeleteField(f.id);
                            },
                          })
                        }
                        title="Delete field"
                      >
                        {deletingFieldId === f.id ? "…" : "✕"}
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
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
              <th style={{ width: "80px" }}></th>
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
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button
                    className="btn-edit-sm"
                    style={{ marginRight: "6px" }}
                    onClick={() => {
                      setEditingState(state);
                      setStateForm({
                        name: state.name,
                        label: state.label,
                        color: state.color ?? "#6366f1",
                        isTerminal: state.isTerminal,
                        slaHours:
                          state.slaHours !== null ? String(state.slaHours) : "",
                        sortOrder: String(state.sortOrder),
                      });
                      setStateError(null);
                    }}
                    title="Edit state"
                  >
                    ✎
                  </button>
                  {state.name !== workflow.initialState ? (
                    <button
                      className="btn-danger-sm"
                      disabled={deletingStateId === state.id}
                      onClick={() =>
                        setConfirmDelete({
                          message: `Delete state "${state.label}"?`,
                          onConfirm: () => {
                            setConfirmDelete(null);
                            void handleDeleteState(state.id);
                          },
                        })
                      }
                      title="Delete state"
                    >
                      {deletingStateId === state.id ? "…" : "✕"}
                    </button>
                  ) : (
                    <span style={{ display: "inline-block", width: "24px" }} />
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
              <th style={{ width: "80px" }}></th>
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
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button
                    className="btn-edit-sm"
                    style={{ marginRight: "6px" }}
                    onClick={() => {
                      setEditingTransition(t);
                      setTransForm({
                        fromState: t.fromState,
                        toState: t.toState,
                        label: t.label,
                        allowedRoles: t.allowedRoles.join(", "),
                        requiresComment: t.requiresComment,
                      });
                      setTransError(null);
                    }}
                    title="Edit transition"
                  >
                    ✎
                  </button>
                  <button
                    className="btn-danger-sm"
                    disabled={deletingTransId === t.id}
                    onClick={() =>
                      setConfirmDelete({
                        message: `Delete transition "${t.label || `${t.fromState} → ${t.toState}`}"?`,
                        onConfirm: () => {
                          setConfirmDelete(null);
                          void handleDeleteTransition(t.id);
                        },
                      })
                    }
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

      {/* Add Field modal */}
      {showAddField && (
        <div className="modal-overlay" onClick={() => setShowAddField(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Add Field</h3>
              <button
                className="modal-close"
                onClick={() => setShowAddField(false)}
              >
                ×
              </button>
            </div>
            <form onSubmit={(e) => void handleAddField(e)}>
              <div className="modal-body">
                {fieldError && (
                  <div
                    className="alert alert-error"
                    style={{ marginBottom: "16px" }}
                  >
                    {fieldError}
                  </div>
                )}
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Label *</label>
                    <input
                      className="form-input"
                      placeholder="e.g. Customer Name"
                      value={fieldForm.label}
                      onChange={(e) => {
                        const label = e.target.value;
                        const name = label
                          .toLowerCase()
                          .replace(/\s+/g, "_")
                          .replace(/[^a-z0-9_]/g, "");
                        setFieldForm((f) => ({ ...f, label, name }));
                      }}
                      required
                      autoFocus
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Field Name *</label>
                    <input
                      className="form-input"
                      placeholder="e.g. customer_name"
                      value={fieldForm.name}
                      onChange={(e) =>
                        setFieldForm((f) => ({ ...f, name: e.target.value }))
                      }
                      pattern="^[a-z_][a-z0-9_]*$"
                      title="snake_case only"
                      required
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Field Type *</label>
                  <select
                    className="form-input"
                    value={fieldForm.fieldType}
                    onChange={(e) =>
                      setFieldForm((f) => ({ ...f, fieldType: e.target.value }))
                    }
                  >
                    {FIELD_TYPES.map((ft) => (
                      <option key={ft.value} value={ft.value}>
                        {ft.label}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="form-checkbox">
                  <input
                    type="checkbox"
                    checked={fieldForm.isRequired}
                    onChange={(e) =>
                      setFieldForm((f) => ({
                        ...f,
                        isRequired: e.target.checked,
                      }))
                    }
                  />
                  <span>Required field</span>
                </label>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowAddField(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={savingField}
                >
                  {savingField ? "Adding…" : "Add Field"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
      {/* Edit Field modal */}
      {editingField && (
        <div className="modal-overlay" onClick={() => setEditingField(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Edit Field — {editingField.label}</h3>
              <button
                className="modal-close"
                onClick={() => setEditingField(null)}
              >
                ×
              </button>
            </div>
            <form onSubmit={(e) => void handleEditField(e)}>
              <div className="modal-body">
                {fieldError && (
                  <div
                    className="alert alert-error"
                    style={{ marginBottom: "16px" }}
                  >
                    {fieldError}
                  </div>
                )}
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Label *</label>
                    <input
                      className="form-input"
                      placeholder="e.g. Customer Name"
                      value={fieldForm.label}
                      onChange={(e) =>
                        setFieldForm((f) => ({ ...f, label: e.target.value }))
                      }
                      required
                      autoFocus
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Field Name (Immutable)</label>
                    <input
                      className="form-input"
                      value={fieldForm.name}
                      disabled
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Field Type (Immutable)</label>
                  <input
                    className="form-input"
                    value={
                      FIELD_TYPES.find((ft) => ft.value === fieldForm.fieldType)
                        ?.label ?? fieldForm.fieldType
                    }
                    disabled
                  />
                </div>
                <label className="form-checkbox">
                  <input
                    type="checkbox"
                    checked={fieldForm.isRequired}
                    onChange={(e) =>
                      setFieldForm((f) => ({
                        ...f,
                        isRequired: e.target.checked,
                      }))
                    }
                  />
                  <span>Required field</span>
                </label>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setEditingField(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={savingField}
                >
                  {savingField ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit State modal */}
      {editingState && (
        <div className="modal-overlay" onClick={() => setEditingState(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Edit State — {editingState.label}</h3>
              <button
                className="modal-close"
                onClick={() => setEditingState(null)}
              >
                ×
              </button>
            </div>
            <form onSubmit={(e) => void handleEditState(e)}>
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
                      onChange={(e) =>
                        setStateForm((f) => ({ ...f, label: e.target.value }))
                      }
                      required
                      autoFocus
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">State Name (Immutable)</label>
                    <input
                      className="form-input"
                      value={stateForm.name}
                      disabled
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
                  onClick={() => setEditingState(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={savingState}
                >
                  {savingState ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Transition modal */}
      {editingTransition && (
        <div
          className="modal-overlay"
          onClick={() => setEditingTransition(null)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Edit Transition</h3>
              <button
                className="modal-close"
                onClick={() => setEditingTransition(null)}
              >
                ×
              </button>
            </div>
            <form onSubmit={(e) => void handleEditTransition(e)}>
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
                    <label className="form-label">From State (Immutable)</label>
                    <input
                      className="form-input"
                      value={transForm.fromState}
                      disabled
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">To State (Immutable)</label>
                    <input
                      className="form-input"
                      value={transForm.toState}
                      disabled
                    />
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
                  onClick={() => setEditingTransition(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={savingTrans}
                >
                  {savingTrans ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Shared confirm-delete modal for fields / states / transitions */}
      {confirmDelete && (
        <ConfirmDeleteModal
          message={confirmDelete.message}
          onConfirm={confirmDelete.onConfirm}
          onCancel={() => setConfirmDelete(null)}
          busy={
            deletingFieldId !== null ||
            deletingStateId !== null ||
            deletingTransId !== null
          }
        />
      )}

      {/* Delete workflow confirmation modal */}
      {showDeleteWorkflow && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !deletingWorkflow)
              setShowDeleteWorkflow(false);
          }}
        >
          <div
            style={{
              background: "var(--bg-primary)",
              border: "1px solid var(--border-color)",
              borderRadius: "16px",
              padding: "28px 32px",
              width: "100%",
              maxWidth: "440px",
              boxShadow: "var(--shadow-lg)",
            }}
          >
            <div style={{ fontSize: "28px", marginBottom: "12px" }}>🗑</div>
            <h3
              style={{ margin: "0 0 8px", fontSize: "18px", fontWeight: 700 }}
            >
              Delete workflow?
            </h3>
            <p
              style={{
                margin: "0 0 6px",
                fontSize: "14px",
                color: "var(--text-secondary)",
              }}
            >
              You are about to permanently delete{" "}
              <strong>"{workflow.name}"</strong>. This will also remove all its
              states and transitions.
            </p>
            <p
              style={{
                margin: "0 0 20px",
                fontSize: "13px",
                color: "var(--danger)",
              }}
            >
              This action cannot be undone.
            </p>

            {deleteWorkflowError && (
              <p
                style={{
                  margin: "0 0 16px",
                  fontSize: "13px",
                  color: "var(--danger)",
                }}
              >
                ⚠ {deleteWorkflowError}
              </p>
            )}

            <div
              style={{
                display: "flex",
                gap: "10px",
                justifyContent: "flex-end",
              }}
            >
              <button
                className="btn btn-secondary"
                onClick={() => setShowDeleteWorkflow(false)}
                disabled={deletingWorkflow}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger-sm"
                onClick={() => void handleDeleteWorkflow()}
                disabled={deletingWorkflow}
                style={{ minWidth: "120px" }}
              >
                {deletingWorkflow ? "Deleting…" : "Delete Workflow"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
