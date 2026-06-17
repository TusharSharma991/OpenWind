import React, { useCallback, useEffect, useState } from "react";
import { useOne } from "@refinedev/core";
import { useParams, Link, useNavigate } from "react-router-dom";
import { fetchWithAuth, API_URL } from "../../lib/api.js";
import { useEntityTypes } from "../../entity-type-context.js";
import { UserPicker } from "../../components/user-picker.js";
import type { UserOption } from "../../components/user-picker.js";

function toWorkflowSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

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
  assignedTo: string | null;
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
          padding: "28px 32px",
          width: "100%",
          maxWidth: "420px",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <div
          style={{
            width: "44px",
            height: "44px",
            borderRadius: "10px",
            background: "hsla(0,84%,60%,.12)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "20px",
            marginBottom: "16px",
          }}
        >
          🗑
        </div>
        <p
          style={{
            margin: "0 0 6px",
            fontSize: "15px",
            color: "var(--text-primary)",
            fontWeight: 600,
          }}
        >
          {message}
        </p>
        <p
          style={{
            margin: "0 0 24px",
            fontSize: "13px",
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

/* ── UX4G Pipeline Flow ─────────────────────────────────────── */
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
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0",
        flexWrap: "wrap",
        padding: "8px 0 4px",
      }}
    >
      {sorted.map((state, i) => {
        const isLast = i === sorted.length - 1;
        const accent = state.color ?? "var(--accent-primary)";
        const isInitial = state.name === initialState;
        return (
          <React.Fragment key={state.id}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "6px",
                minWidth: "90px",
              }}
            >
              <div
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "50%",
                  background: `${accent}22`,
                  border: `2px solid ${accent}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  position: "relative",
                }}
              >
                <span
                  style={{
                    width: "10px",
                    height: "10px",
                    borderRadius: "50%",
                    background: accent,
                    display: "block",
                  }}
                />
                {isInitial && (
                  <span
                    style={{
                      position: "absolute",
                      top: "-8px",
                      left: "50%",
                      transform: "translateX(-50%)",
                      fontSize: "9px",
                      fontWeight: 700,
                      color: "var(--accent-primary)",
                      letterSpacing: "0.3px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    START
                  </span>
                )}
                {state.isTerminal && (
                  <span
                    style={{
                      position: "absolute",
                      bottom: "-8px",
                      left: "50%",
                      transform: "translateX(-50%)",
                      fontSize: "9px",
                      fontWeight: 700,
                      color: "var(--text-muted)",
                      letterSpacing: "0.3px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    END
                  </span>
                )}
              </div>
              <div style={{ textAlign: "center" }}>
                <div
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    lineHeight: 1.2,
                  }}
                >
                  {state.label}
                </div>
                {state.slaHours !== null && (
                  <div
                    style={{
                      fontSize: "10px",
                      color: "var(--warning)",
                      fontWeight: 600,
                      marginTop: "2px",
                    }}
                  >
                    SLA {state.slaHours}h
                  </div>
                )}
              </div>
            </div>
            {!isLast && (
              <div
                style={{
                  flex: 1,
                  minWidth: "24px",
                  height: "2px",
                  background: "var(--border-color)",
                  position: "relative",
                  top: "-12px",
                  margin: "0 4px",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    right: "-4px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--text-muted)",
                    fontSize: "14px",
                    lineHeight: 1,
                  }}
                >
                  ›
                </span>
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ── KPI Chip ───────────────────────────────────────────────── */
function KpiChip({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent: string;
}): React.ReactElement {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "2px",
        padding: "10px 20px",
        background: "var(--bg-card)",
        border: "1px solid var(--border-color)",
        borderTop: `3px solid ${accent}`,
        borderRadius: "var(--radius-md)",
        minWidth: "90px",
      }}
    >
      <span
        style={{
          fontSize: "20px",
          fontWeight: 700,
          color: accent,
          lineHeight: 1,
          fontFamily: "var(--font-heading)",
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontSize: "10px",
          fontWeight: 600,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}
      >
        {label}
      </span>
    </div>
  );
}

/* ── Section Header ─────────────────────────────────────────── */
function SectionHeader({
  label,
  count,
  action,
}: {
  label: string;
  count?: number;
  action?: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <span
          style={{
            fontSize: "11px",
            fontWeight: 700,
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.8px",
          }}
        >
          {label}
        </span>
        {count !== undefined && (
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "var(--accent-primary)",
              background: "hsla(250,84%,60%,.1)",
              border: "1px solid hsla(250,84%,60%,.2)",
              borderRadius: "20px",
              padding: "1px 8px",
            }}
          >
            {count}
          </span>
        )}
      </div>
      {action}
    </div>
  );
}

export function WorkflowDetail(): React.ReactElement {
  const { workflowSlug } = useParams<{ workflowSlug: string }>();
  const navigate = useNavigate();
  useEntityTypes();

  // Resolve slug → UUID once on mount
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    if (!workflowSlug) return;
    fetchWithAuth(`${API_URL}/workflows`)
      .then((res) => {
        const all =
          (res as { data?: Array<{ id: string; name: string }> }).data ?? [];
        const match = all.find((w) => toWorkflowSlug(w.name) === workflowSlug);
        if (match) setId(match.id);
      })
      .catch(() => {
        /* leave id null — useOne will show not-found */
      });
  }, [workflowSlug]);

  const { data, isLoading, refetch } = useOne<WorkflowFull>({
    resource: "workflows",
    id: id ?? "missing",
    queryOptions: { enabled: !!id },
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

  // User assignment
  const [orgUsers, setOrgUsers] = useState<UserOption[]>([]);
  const [assignedTo, setAssignedTo] = useState<string | null>(null);
  const [savingAssign, setSavingAssign] = useState(false);

  useEffect(() => {
    fetchWithAuth(`${API_URL}/users`)
      .then((res) => {
        setOrgUsers((res as { data?: UserOption[] }).data ?? []);
      })
      .catch(() => {
        /* users list unavailable — picker stays empty */
      });
  }, []);

  useEffect(() => {
    if (data?.data) {
      setAssignedTo((data.data as WorkflowFull).assignedTo ?? null);
    }
  }, [data?.data]);

  async function handleAssign(userId: string | null): Promise<void> {
    if (!id) return;
    setSavingAssign(true);
    try {
      await fetchWithAuth(`${API_URL}/workflows/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ assignedTo: userId }),
      });
      setAssignedTo(userId);
      void refetch();
    } catch {
      // ignore — keep current assignment
    } finally {
      setSavingAssign(false);
    }
  }

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
  const slaStates = workflow.states.filter((s) => s.slaHours !== null).length;

  return (
    <div>
      {/* ── Breadcrumb ─────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          marginBottom: "20px",
          fontSize: "12px",
          color: "var(--text-muted)",
        }}
      >
        <Link
          to="/workflows"
          style={{
            color: "var(--accent-primary)",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          Workflows
        </Link>
        <span>/</span>
        <span style={{ color: "var(--text-secondary)", fontWeight: 500 }}>
          {workflow.name}
        </span>
      </div>

      {/* ── Page Header ────────────────────────────────────── */}
      <div
        style={{
          background: "var(--bg-secondary)",
          border: "1px solid var(--border-color)",
          borderRadius: "var(--radius-lg)",
          padding: "24px 28px",
          marginBottom: "20px",
          borderLeft: "4px solid var(--accent-primary)",
        }}
      >
        <div
          className="wfd-page-inner"
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "20px",
            flexWrap: "wrap",
          }}
        >
          {/* Left: title block */}
          <div
            style={{ display: "flex", alignItems: "flex-start", gap: "16px" }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "12px",
                background: "hsla(250,84%,60%,.12)",
                border: "1px solid hsla(250,84%,60%,.25)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth="2"
                stroke="var(--accent-primary)"
                style={{ width: "22px", height: "22px" }}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 8.689c0-.864.933-1.406 1.683-.977l7.108 4.061a1.125 1.125 0 010 1.954l-7.108 4.061A1.125 1.125 0 013 16.811V8.69zM12.75 8.689c0-.864.933-1.406 1.683-.977l7.108 4.061a1.125 1.125 0 010 1.954l-7.108 4.061a1.125 1.125 0 01-1.683-.977V8.69z"
                />
              </svg>
            </div>
            <div>
              <h2
                className="wfd-page-title"
                style={{
                  margin: "0 0 8px",
                  fontSize: "22px",
                  fontWeight: 700,
                  color: "var(--text-primary)",
                  fontFamily: "var(--font-heading)",
                }}
              >
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
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                    fontSize: "12px",
                    fontWeight: 600,
                  }}
                >
                  <span
                    style={{
                      width: "7px",
                      height: "7px",
                      borderRadius: "50%",
                      background: workflow.isActive
                        ? "var(--success)"
                        : "var(--text-muted)",
                      display: "inline-block",
                    }}
                  />
                  <span
                    style={{
                      color: workflow.isActive
                        ? "var(--success)"
                        : "var(--text-muted)",
                    }}
                  >
                    {workflow.isActive ? "Active" : "Inactive"}
                  </span>
                </span>
                <span
                  style={{
                    width: "1px",
                    height: "12px",
                    background: "var(--border-color)",
                    display: "inline-block",
                  }}
                />
                <span
                  style={{ fontSize: "12px", color: "var(--text-secondary)" }}
                >
                  Created {new Date(workflow.createdAt).toLocaleDateString()}
                </span>
                <span
                  style={{
                    width: "1px",
                    height: "12px",
                    background: "var(--border-color)",
                    display: "inline-block",
                  }}
                />
                <Link
                  to={`/entity-types/${workflow.entityTypeId}`}
                  style={{
                    fontSize: "12px",
                    color: "var(--accent-primary)",
                    textDecoration: "none",
                    fontWeight: 600,
                  }}
                >
                  Manage Fields ↗
                </Link>
              </div>
            </div>
          </div>

          {/* Right: action buttons */}
          <div
            className="wfd-header-actions"
            style={{
              display: "flex",
              gap: "10px",
              alignItems: "center",
              flexShrink: 0,
              flexWrap: "wrap",
            }}
          >
            <button
              className="btn-primary"
              onClick={() =>
                navigate(`/workflows/${toWorkflowSlug(workflow.name)}/records`)
              }
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
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              View Records
            </button>
            <button
              className={
                workflow.isActive ? "btn btn-secondary" : "btn-primary"
              }
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
              className="icon-btn icon-btn-delete"
              style={{ width: "36px", height: "36px" }}
              onClick={() => setShowDeleteWorkflow(true)}
              title="Delete workflow"
              aria-label="Delete workflow"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
              </svg>
            </button>
          </div>
        </div>

        {/* KPI strip */}
        <div
          className="wfd-kpi-strip"
          style={{
            display: "flex",
            gap: "12px",
            marginTop: "20px",
            flexWrap: "wrap",
          }}
        >
          <KpiChip
            label="States"
            value={workflow.states.length}
            accent="var(--accent-primary)"
          />
          <KpiChip
            label="Transitions"
            value={workflow.transitions.length}
            accent="hsl(185,80%,40%)"
          />
          <KpiChip
            label="Fields"
            value={fieldsLoading ? "…" : fields.length}
            accent="hsl(265,84%,60%)"
          />
          <KpiChip
            label="SLA States"
            value={slaStates}
            accent="hsl(35,90%,50%)"
          />
        </div>
      </div>

      {/* ── Assign Workflow ─────────────────────────────────────────────── */}
      <div
        className="data-panel"
        style={{
          marginBottom: "20px",
          display: "flex",
          alignItems: "center",
          gap: "16px",
          padding: "14px 20px",
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            minWidth: "120px",
          }}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <span
            style={{
              fontSize: "13px",
              fontWeight: 600,
              color: "var(--text-secondary)",
            }}
          >
            Workflow Admin
          </span>
        </div>
        <UserPicker
          users={orgUsers}
          value={assignedTo}
          onChange={(uid) => void handleAssign(uid)}
          placeholder="Assign workflow admin…"
          disabled={savingAssign}
        />
        {savingAssign && (
          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            Saving…
          </span>
        )}
        {!savingAssign && assignedTo && (
          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            This user has full admin access over this workflow.
          </span>
        )}
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

      {/* ── Two-column layout ──────────────────────────────── */}
      <div
        className="wfd-two-col"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 300px",
          gap: "20px",
          alignItems: "start",
        }}
      >
        {/* ── Left column ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* State Flow */}
          <div
            className="data-panel"
            style={{ borderTop: "3px solid var(--accent-primary)" }}
          >
            <SectionHeader label="State Pipeline" />
            <StateFlowDiagram
              states={workflow.states}
              transitions={workflow.transitions}
              initialState={workflow.initialState}
            />
          </div>

          {/* Fields */}
          <div
            className="data-panel"
            style={{ borderTop: "3px solid hsl(265,84%,60%)" }}
          >
            <SectionHeader
              label="Fields"
              count={fields.length}
              action={
                <button
                  className="btn-primary btn-sm"
                  onClick={() => setShowAddField(true)}
                >
                  + Add Field
                </button>
              }
            />
            {fieldsLoading ? (
              <div style={{ padding: "20px", textAlign: "center" }}>
                <div className="spinner" style={{ margin: "0 auto" }} />
              </div>
            ) : fields.length === 0 ? (
              <div
                className="empty-state-inline"
                style={{ padding: "28px", fontSize: "13px" }}
              >
                No fields yet. Add fields to capture data on records.
              </div>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th className="wfd-table-hide-xs">Type</th>
                      <th className="wfd-table-hide-xs">Required</th>
                      <th style={{ width: "80px" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...fields]
                      .sort((a, b) => a.sortOrder - b.sortOrder)
                      .map((f) => (
                        <tr key={f.id}>
                          <td>
                            <div>
                              <div
                                style={{ fontWeight: 600, fontSize: "13px" }}
                              >
                                {f.label}
                              </div>
                              <code
                                className="code-inline"
                                style={{ fontSize: "11px" }}
                              >
                                {f.name}
                              </code>
                            </div>
                          </td>
                          <td className="wfd-table-hide-xs">
                            <span className="badge badge-muted">
                              {f.fieldType}
                            </span>
                          </td>
                          <td className="wfd-table-hide-xs">
                            {f.isRequired ? (
                              <span className="badge badge-primary">Yes</span>
                            ) : (
                              <span className="text-muted-sm">—</span>
                            )}
                          </td>
                          <td
                            style={{ textAlign: "right", whiteSpace: "nowrap" }}
                          >
                            <div
                              style={{
                                display: "flex",
                                gap: "6px",
                                justifyContent: "flex-end",
                              }}
                            >
                              <button
                                className="icon-btn icon-btn-edit"
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
                                <svg
                                  width="13"
                                  height="13"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                                </svg>
                              </button>
                              <button
                                className="icon-btn icon-btn-delete"
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
                                {deletingFieldId === f.id ? (
                                  <span style={{ fontSize: "11px" }}>…</span>
                                ) : (
                                  <svg
                                    width="13"
                                    height="13"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <polyline points="3 6 5 6 21 6" />
                                    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                                    <path d="M10 11v6M14 11v6" />
                                  </svg>
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* States */}
          <div
            className="data-panel"
            style={{ borderTop: "3px solid hsl(185,80%,40%)" }}
          >
            <SectionHeader
              label="States"
              count={workflow.states.length}
              action={
                <button
                  className="btn-primary btn-sm"
                  onClick={() => setShowAddState(true)}
                >
                  + Add State
                </button>
              }
            />
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>State</th>
                    <th>Type</th>
                    <th className="wfd-table-hide-xs">SLA</th>
                    <th className="wfd-table-hide-xs">Order</th>
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
                          <div>
                            <div style={{ fontWeight: 600, fontSize: "13px" }}>
                              {state.label}
                            </div>
                            <code
                              className="code-inline"
                              style={{ fontSize: "11px" }}
                            >
                              {state.name}
                            </code>
                          </div>
                        </div>
                      </td>
                      <td>
                        {state.isTerminal ? (
                          <span className="badge badge-muted">Terminal</span>
                        ) : state.name === workflow.initialState ? (
                          <span className="badge badge-primary">Initial</span>
                        ) : (
                          <span className="badge badge-success">Active</span>
                        )}
                      </td>
                      <td
                        className="wfd-table-hide-xs"
                        style={{ fontSize: "13px" }}
                      >
                        {state.slaHours !== null ? (
                          <span
                            style={{
                              color: "var(--warning)",
                              fontWeight: 600,
                            }}
                          >
                            {state.slaHours}h
                          </span>
                        ) : (
                          <span className="text-muted-sm">—</span>
                        )}
                      </td>
                      <td
                        className="wfd-table-hide-xs"
                        style={{ fontSize: "13px", color: "var(--text-muted)" }}
                      >
                        {state.sortOrder}
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <div
                          style={{
                            display: "flex",
                            gap: "6px",
                            justifyContent: "flex-end",
                          }}
                        >
                          <button
                            className="icon-btn icon-btn-edit"
                            onClick={() => {
                              setEditingState(state);
                              setStateForm({
                                name: state.name,
                                label: state.label,
                                color: state.color ?? "#6366f1",
                                isTerminal: state.isTerminal,
                                slaHours:
                                  state.slaHours !== null
                                    ? String(state.slaHours)
                                    : "",
                                sortOrder: String(state.sortOrder),
                              });
                              setStateError(null);
                            }}
                            title="Edit state"
                          >
                            <svg
                              width="13"
                              height="13"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>
                          {state.name !== workflow.initialState ? (
                            <button
                              className="icon-btn icon-btn-delete"
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
                              {deletingStateId === state.id ? (
                                <span style={{ fontSize: "11px" }}>…</span>
                              ) : (
                                <svg
                                  width="13"
                                  height="13"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <polyline points="3 6 5 6 21 6" />
                                  <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                                  <path d="M10 11v6M14 11v6" />
                                </svg>
                              )}
                            </button>
                          ) : (
                            <span
                              style={{ display: "inline-block", width: "30px" }}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Transitions */}
          <div
            className="data-panel"
            style={{ borderTop: "3px solid hsl(35,90%,50%)" }}
          >
            <SectionHeader
              label="Transitions"
              count={workflow.transitions.length}
              action={
                <button
                  className="btn-primary btn-sm"
                  onClick={() => setShowAddTransition(true)}
                >
                  + Add Transition
                </button>
              }
            />
            {workflow.transitions.length === 0 ? (
              <div
                className="empty-state-inline"
                style={{ padding: "28px", fontSize: "13px" }}
              >
                No transitions yet. Add transitions to define how records move
                between states.
              </div>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Route</th>
                      <th className="wfd-table-hide-xs">Label</th>
                      <th className="wfd-table-hide-xs">Allowed Roles</th>
                      <th className="wfd-table-hide-xs">Requirements</th>
                      <th style={{ width: "80px" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {workflow.transitions.map((t) => (
                      <tr key={t.id}>
                        <td>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                              flexWrap: "wrap",
                            }}
                          >
                            <code
                              className="code-inline"
                              style={{ fontSize: "11px" }}
                            >
                              {t.fromState}
                            </code>
                            <span
                              style={{
                                color: "var(--accent-primary)",
                                fontWeight: 700,
                                fontSize: "14px",
                              }}
                            >
                              →
                            </span>
                            <code
                              className="code-inline"
                              style={{ fontSize: "11px" }}
                            >
                              {t.toState}
                            </code>
                          </div>
                        </td>
                        <td
                          className="wfd-table-hide-xs"
                          style={{ fontWeight: 500, fontSize: "13px" }}
                        >
                          {t.label || <span className="text-muted-sm">—</span>}
                        </td>
                        <td className="wfd-table-hide-xs">
                          {t.allowedRoles.length === 0 ? (
                            <span className="text-muted-sm">Any</span>
                          ) : (
                            <div
                              style={{
                                display: "flex",
                                gap: "4px",
                                flexWrap: "wrap",
                              }}
                            >
                              {t.allowedRoles.map((r) => (
                                <span key={r} className="badge badge-primary">
                                  {r}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="wfd-table-hide-xs">
                          {!t.requiresComment &&
                          t.requiresFields.length === 0 ? (
                            <span className="text-muted-sm">—</span>
                          ) : (
                            <div
                              style={{
                                display: "flex",
                                gap: "4px",
                                flexWrap: "wrap",
                              }}
                            >
                              {t.requiresComment && (
                                <span className="badge badge-warning">
                                  Comment
                                </span>
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
                        <td
                          style={{ textAlign: "right", whiteSpace: "nowrap" }}
                        >
                          <div
                            style={{
                              display: "flex",
                              gap: "6px",
                              justifyContent: "flex-end",
                            }}
                          >
                            <button
                              className="icon-btn icon-btn-edit"
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
                              <svg
                                width="13"
                                height="13"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                              </svg>
                            </button>
                            <button
                              className="icon-btn icon-btn-delete"
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
                              {deletingTransId === t.id ? (
                                <span style={{ fontSize: "11px" }}>…</span>
                              ) : (
                                <svg
                                  width="13"
                                  height="13"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <polyline points="3 6 5 6 21 6" />
                                  <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                                  <path d="M10 11v6M14 11v6" />
                                </svg>
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ── Right sidebar ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Summary card */}
          <div
            className="data-panel"
            style={{ borderTop: "3px solid var(--accent-primary)" }}
          >
            <SectionHeader label="Workflow Info" />
            <div
              style={{ display: "flex", flexDirection: "column", gap: "12px" }}
            >
              {[
                { label: "Workflow ID", value: id?.slice(0, 8) + "…" },
                { label: "Initial State", value: workflow.initialState },
                {
                  label: "Terminal States",
                  value:
                    workflow.states
                      .filter((s) => s.isTerminal)
                      .map((s) => s.label)
                      .join(", ") || "None",
                },
                {
                  label: "SLA Coverage",
                  value:
                    slaStates > 0
                      ? `${slaStates} of ${workflow.states.length} states`
                      : "No SLAs set",
                },
              ].map((row) => (
                <div key={row.label}>
                  <div
                    style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                      marginBottom: "3px",
                    }}
                  >
                    {row.label}
                  </div>
                  <div
                    style={{
                      fontSize: "13px",
                      fontWeight: 500,
                      color: "var(--text-primary)",
                      wordBreak: "break-all",
                    }}
                  >
                    {row.value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* State color legend */}
          {workflow.states.length > 0 && (
            <div className="data-panel">
              <SectionHeader label="State Colors" />
              <div
                style={{ display: "flex", flexDirection: "column", gap: "8px" }}
              >
                {sortedStates.map((s) => (
                  <div
                    key={s.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "6px 10px",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--bg-tertiary)",
                    }}
                  >
                    <span
                      style={{
                        width: "10px",
                        height: "10px",
                        borderRadius: "50%",
                        background: s.color ?? "var(--accent-primary)",
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        fontSize: "12px",
                        fontWeight: 500,
                        color: "var(--text-primary)",
                        flex: 1,
                      }}
                    >
                      {s.label}
                    </span>
                    {s.name === workflow.initialState && (
                      <span
                        style={{
                          fontSize: "9px",
                          fontWeight: 700,
                          color: "var(--accent-primary)",
                          textTransform: "uppercase",
                          letterSpacing: "0.4px",
                        }}
                      >
                        start
                      </span>
                    )}
                    {s.isTerminal && (
                      <span
                        style={{
                          fontSize: "9px",
                          fontWeight: 700,
                          color: "var(--text-muted)",
                          textTransform: "uppercase",
                          letterSpacing: "0.4px",
                        }}
                      >
                        end
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick actions */}
          <div className="data-panel">
            <SectionHeader label="Quick Actions" />
            <div
              style={{ display: "flex", flexDirection: "column", gap: "8px" }}
            >
              <button
                className="btn btn-secondary"
                style={{
                  width: "100%",
                  textAlign: "left",
                  justifyContent: "flex-start",
                }}
                onClick={() => setShowAddState(true)}
              >
                + Add State
              </button>
              <button
                className="btn btn-secondary"
                style={{
                  width: "100%",
                  textAlign: "left",
                  justifyContent: "flex-start",
                }}
                onClick={() => setShowAddTransition(true)}
              >
                + Add Transition
              </button>
              <button
                className="btn btn-secondary"
                style={{
                  width: "100%",
                  textAlign: "left",
                  justifyContent: "flex-start",
                }}
                onClick={() => setShowAddField(true)}
              >
                + Add Field
              </button>
              <button
                className="btn-primary"
                style={{ width: "100%" }}
                onClick={() =>
                  navigate(
                    `/workflows/${toWorkflowSlug(workflow.name)}/records`,
                  )
                }
              >
                View Records →
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Modals ─────────────────────────────────────────── */}

      {/* Add Field */}
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
                      setFieldForm((f) => ({
                        ...f,
                        fieldType: e.target.value,
                      }))
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

      {/* Add State */}
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
                          setStateForm((f) => ({
                            ...f,
                            color: e.target.value,
                          }))
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
                          setStateForm((f) => ({
                            ...f,
                            color: e.target.value,
                          }))
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
                      setStateForm((f) => ({
                        ...f,
                        slaHours: e.target.value,
                      }))
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

      {/* Add Transition */}
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
                        setTransForm((f) => ({
                          ...f,
                          toState: e.target.value,
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

      {/* Edit Field */}
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

      {/* Edit State */}
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
                          setStateForm((f) => ({
                            ...f,
                            color: e.target.value,
                          }))
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
                          setStateForm((f) => ({
                            ...f,
                            color: e.target.value,
                          }))
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
                      setStateForm((f) => ({
                        ...f,
                        slaHours: e.target.value,
                      }))
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

      {/* Edit Transition */}
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

      {/* Shared confirm-delete */}
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

      {/* Delete workflow */}
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
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "12px",
                background: "hsla(0,84%,60%,.12)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "22px",
                marginBottom: "16px",
              }}
            >
              🗑
            </div>
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
