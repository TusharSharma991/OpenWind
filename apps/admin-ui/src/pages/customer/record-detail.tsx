import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { fetchWithAuth, API_URL } from "../../lib/api.js";
import { useEntityTypes } from "../../entity-type-context.js";

type EntityField = {
  id: string;
  name: string;
  label: string;
  fieldType: string;
  isSystem: boolean;
  isRequired: boolean;
  config: {
    options?: Array<string | { label: string; value: string; color?: string }>;
    allowedCurrencies?: string[];
  };
};
type EntityInstance = {
  id: string;
  workflowId: string | null;
  currentState: string | null;
  fields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  assignedTo: string | null;
};
type Transition = {
  id: string;
  fromState: string;
  toState: string;
  label: string;
  requiresComment: boolean;
};
type WorkflowState = {
  id: string;
  name: string;
  label: string;
  color: string | null;
  isTerminal: boolean;
};
type WorkflowEvent = {
  id: string;
  fromState: string | null;
  toState: string;
  actorId: string;
  comment: string | null;
  triggeredAt: string;
  metadata?: Record<string, unknown>;
};

/* ── Field display ───────────────────────────────────────────── */
function FieldValue({
  value,
  fieldType,
  field,
}: {
  value: unknown;
  fieldType: string;
  field?: EntityField;
}): React.ReactElement {
  if (value === null || value === undefined)
    return <span className="rcd-muted">—</span>;
  if (fieldType === "boolean") {
    const bv = Boolean(value);
    return (
      <span className={`portal-bool-badge ${bv ? "yes" : "no"}`}>
        {bv ? "Yes" : "No"}
      </span>
    );
  }
  if (fieldType === "date" || fieldType === "datetime") {
    const d = new Date(value as string);
    return (
      <span>{isNaN(d.getTime()) ? String(value) : d.toLocaleString()}</span>
    );
  }
  if (fieldType === "currency" && typeof value === "object") {
    const cv = value as { amount?: unknown; currency?: unknown };
    return (
      <span>
        {String(cv.currency ?? "")}{" "}
        {cv.amount !== null && cv.amount !== undefined
          ? String(cv.amount)
          : "—"}
      </span>
    );
  }
  if ((fieldType === "enum" || fieldType === "multi_enum") && field) {
    const strVal = String(value);
    const opts = field.config.options ?? [];
    const match = opts.find(
      (o) => (typeof o === "string" ? o : o.value) === strVal,
    );
    const label = match
      ? typeof match === "string"
        ? match
        : match.label
      : strVal;
    const color = match && typeof match !== "string" ? match.color : undefined;
    return (
      <span
        className="portal-enum-badge"
        style={
          color
            ? {
                borderLeft: `3px solid ${color}`,
                background: `${color}18`,
                color,
              }
            : undefined
        }
      >
        {label}
      </span>
    );
  }
  return <span>{String(value)}</span>;
}

/* ── Field input (edit mode) ─────────────────────────────────── */
function FieldInput({
  field,
  value,
  onChange,
}: {
  field: EntityField;
  value: unknown;
  onChange: (v: unknown) => void;
}): React.ReactElement {
  const strVal = value === null || value === undefined ? "" : String(value);
  switch (field.fieldType) {
    case "boolean":
      return (
        <label className="portal-checkbox">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>{field.label}</span>
        </label>
      );
    case "number":
      return (
        <input
          className="portal-input"
          type="number"
          value={strVal}
          onChange={(e) =>
            onChange(e.target.value === "" ? null : Number(e.target.value))
          }
        />
      );
    case "currency": {
      const currVal =
        value !== null && typeof value === "object"
          ? (value as { amount?: unknown; currency?: unknown })
          : { amount: "", currency: "" };
      const amountStr =
        currVal.amount === null || currVal.amount === undefined
          ? ""
          : String(currVal.amount);
      const currencyStr =
        currVal.currency === null || currVal.currency === undefined
          ? ""
          : String(currVal.currency);
      const allowed = field.config.allowedCurrencies ?? [];
      const currencies =
        allowed.length > 0 ? allowed : ["USD", "EUR", "GBP", "INR", "AED"];
      return (
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            className="portal-input"
            type="number"
            placeholder="0.00"
            value={amountStr}
            style={{ flex: 1 }}
            onChange={(e) =>
              onChange({
                amount: e.target.value === "" ? null : Number(e.target.value),
                currency: currencyStr || currencies[0],
              })
            }
          />
          <select
            className="portal-input"
            value={currencyStr || currencies[0]}
            style={{ width: "90px" }}
            onChange={(e) =>
              onChange({
                amount: amountStr === "" ? null : Number(amountStr),
                currency: e.target.value,
              })
            }
          >
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      );
    }
    case "date":
      return (
        <input
          className="portal-input"
          type="date"
          value={strVal}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    case "datetime":
      return (
        <input
          className="portal-input"
          type="datetime-local"
          value={strVal}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    case "enum":
    case "multi_enum": {
      const opts = (field.config.options ?? []).map((o) =>
        typeof o === "string"
          ? { label: o, value: o }
          : { label: o.label, value: o.value },
      );
      return (
        <select
          className="portal-input"
          value={strVal}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">Select…</option>
          {opts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    case "longtext":
      return (
        <textarea
          className="portal-input portal-textarea"
          value={strVal}
          rows={4}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    default:
      return (
        <input
          className="portal-input"
          type="text"
          value={strVal}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
  }
}

/* ── State badge with color ──────────────────────────────────── */
function StateBadge({
  stateName,
  allStates,
}: {
  stateName: string | null;
  allStates: WorkflowState[];
}): React.ReactElement {
  if (!stateName) return <span className="rcd-muted">—</span>;
  const stateObj = allStates.find((s) => s.name === stateName);
  const color = stateObj?.color ?? null;
  return (
    <span
      className="rcd-state-badge"
      style={
        color
          ? {
              background: `${color}20`,
              color,
              borderColor: `${color}55`,
            }
          : undefined
      }
    >
      <span
        className="rcd-state-dot"
        style={color ? { background: color } : undefined}
      />
      {stateObj?.label ?? stateName}
    </span>
  );
}

/* ── History event icon ──────────────────────────────────────── */
function HistoryIcon({
  type,
}: {
  type: "create" | "update" | "transition";
}): React.ReactElement {
  if (type === "create") {
    return (
      <div className="rcd-tl-icon rcd-tl-icon-create">
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </div>
    );
  }
  if (type === "update") {
    return (
      <div className="rcd-tl-icon rcd-tl-icon-update">
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      </div>
    );
  }
  return (
    <div className="rcd-tl-icon rcd-tl-icon-transition">
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="5 12 19 12" />
        <polyline points="13 6 19 12 13 18" />
      </svg>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════ */
export function CustomerRecordDetail(): React.ReactElement {
  const { typeSlug, id } = useParams<{ typeSlug: string; id: string }>();
  const { getTypeBySlug } = useEntityTypes();
  const entityType = typeSlug ? getTypeBySlug(typeSlug) : undefined;
  const entityTypeId = entityType?.id;

  const [fields, setFields] = useState<EntityField[]>([]);
  const [record, setRecord] = useState<EntityInstance | null>(null);
  const [history, setHistory] = useState<WorkflowEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState<string | null>(null);
  const [stateModal, setStateModal] = useState<Transition | null>(null);
  const [comment, setComment] = useState("");
  const [transError, setTransError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [allStates, setAllStates] = useState<WorkflowState[]>([]);
  const [allTransitions, setAllTransitions] = useState<Transition[]>([]);
  const [currentState, setCurrentState] = useState("");
  const [users, setUsers] = useState<
    Array<{ userId: string; email: string; displayName: string | null }>
  >([]);

  const getFieldLabel = (fieldName: string): string => {
    if (fieldName === "state" || fieldName === "currentState") return "State";
    if (fieldName === "assignedTo") return "Assigned To";
    const found = fields.find((f) => f.name === fieldName);
    return found ? found.label : fieldName;
  };

  const getActorName = (actorId: string | null): string => {
    if (!actorId) return "System";
    const u = users.find((user) => user.userId === actorId);
    return u?.displayName ?? u?.email ?? actorId.slice(0, 8) + "…";
  };

  function loadRecord(): Promise<void> {
    if (!entityTypeId || !id) return Promise.resolve();
    return Promise.all([
      fetchWithAuth(`${API_URL}/entity-types/${entityTypeId}/fields`),
      fetchWithAuth(`${API_URL}/entities/${id}`),
      fetchWithAuth(`${API_URL}/entities/${id}/transitions/history`).catch(
        () => ({ data: [] }),
      ),
      fetchWithAuth(`${API_URL}/users`).catch(() => ({ data: [] })),
    ])
      .then(([fieldsRes, recRes, histRes, usersRes]) => {
        setFields(
          (fieldsRes as { data: EntityField[] }).data.filter(
            (f) => !f.isSystem,
          ),
        );
        setRecord((recRes as { data: EntityInstance }).data);
        setHistory((histRes as { data?: WorkflowEvent[] }).data ?? []);
        setUsers(
          (
            usersRes as {
              data?: Array<{
                userId: string;
                email: string;
                displayName: string | null;
              }>;
            }
          ).data ?? [],
        );
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load"),
      )
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    void loadRecord();
  }, [entityTypeId, id]);

  useEffect(() => {
    if (!record?.workflowId && !entityTypeId) {
      setAllStates([]);
      setAllTransitions([]);
      return;
    }

    const wfUrl = record?.workflowId
      ? `${API_URL}/workflows/${record.workflowId}`
      : `${API_URL}/workflows?${new URLSearchParams({ entityTypeId: entityTypeId ?? "" }).toString()}`;

    fetchWithAuth(wfUrl)
      .then((res) => {
        const wf = record?.workflowId
          ? (
              res as {
                data: { states: WorkflowState[]; transitions: Transition[] };
              }
            ).data
          : ((
              res as {
                data?: Array<{
                  states?: WorkflowState[];
                  transitions?: Transition[];
                }>;
              }
            ).data ?? [])[0];
        if (wf) {
          setAllStates(wf.states as WorkflowState[]);
          setAllTransitions(wf.transitions as Transition[]);
        } else {
          setAllStates([]);
          setAllTransitions([]);
        }
      })
      .catch(() => {
        setAllStates([]);
        setAllTransitions([]);
      });
  }, [record?.workflowId, entityTypeId]);

  async function saveEdit(): Promise<void> {
    if (!id) return;
    setSaving(true);
    setSaveError(null);
    try {
      await fetchWithAuth(`${API_URL}/entities/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ fields: editValues, currentState }),
      });
      setEditing(false);
      setLoading(true);
      void loadRecord();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function executeTransition(
    transition: Transition,
    userComment?: string,
  ): Promise<void> {
    if (!id) return;
    setTransitioning(transition.id);
    setTransError(null);
    try {
      await fetchWithAuth(`${API_URL}/entities/${id}/transitions`, {
        method: "POST",
        body: JSON.stringify({
          transitionId: transition.id,
          ...(userComment ? { comment: userComment } : {}),
        }),
      });
      setComment("");
      setStateModal(null);
      setLoading(true);
      void loadRecord();
    } catch (err) {
      setTransError(err instanceof Error ? err.message : "Transition failed");
    } finally {
      setTransitioning(null);
    }
  }

  if (loading)
    return (
      <div className="portal-loading">
        <div className="spinner" />
      </div>
    );

  if (error || !record) {
    return (
      <div className="rcd-page">
        <div className="portal-alert-error">{error ?? "Record not found"}</div>
        <Link
          to={`/records/${typeSlug ?? ""}`}
          className="portal-back-link"
          style={{ marginTop: "12px", display: "inline-block" }}
        >
          ← Back
        </Link>
      </div>
    );
  }

  const availableTransitions = allTransitions.filter(
    (t) => t.fromState === record.currentState,
  );
  const currentStateObj = allStates.find((s) => s.name === record.currentState);
  const isTerminal = currentStateObj?.isTerminal ?? false;

  const titleField = fields.find(
    (f) => f.name === "subject" || f.name === "title" || f.name === "name",
  );
  const recordTitle = titleField
    ? String(record.fields[titleField.name] ?? "")
    : `${entityType?.name ?? "Record"} #${record.id.slice(0, 8)}`;

  return (
    <div className="rcd-page">
      {/* ── Breadcrumb ───────────────────────────────────────── */}
      <div className="rcd-breadcrumb">
        <Link to={`/records/${typeSlug ?? ""}`} className="rcd-bc-link">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          {entityType?.plural ?? "Records"}
        </Link>
        <span className="rcd-bc-sep">/</span>
        <span className="rcd-bc-current">{recordTitle}</span>
      </div>

      {/* ── Page Header ─────────────────────────────────────── */}
      <div className="rcd-header">
        <div className="rcd-header-left">
          <div className="rcd-header-icon">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="7" width="20" height="14" rx="2" />
              <path d="M16 3H8a2 2 0 00-2 2v2h12V5a2 2 0 00-2-2z" />
            </svg>
          </div>
          <div>
            <h1 className="rcd-title">{recordTitle}</h1>
            <div className="rcd-meta-row">
              <StateBadge
                stateName={record.currentState}
                allStates={allStates}
              />
              <span className="rcd-meta-sep" />
              <span className="rcd-meta-text">
                Created{" "}
                {new Date(record.createdAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
              <span className="rcd-meta-sep" />
              <span className="rcd-meta-text">
                Updated{" "}
                {new Date(record.updatedAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
              <span className="rcd-id-chip">{record.id.slice(0, 8)}</span>
            </div>
          </div>
        </div>

        {!editing && (
          <button
            className="rcd-edit-btn"
            onClick={() => {
              setEditValues(record.fields);
              setCurrentState(record.currentState ?? "");
              setEditing(true);
              setSaveError(null);
            }}
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
              aria-hidden="true"
            >
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Edit
          </button>
        )}
      </div>

      {transError && (
        <div className="portal-alert-error rcd-trans-error">
          ⚠ {transError}
          <button
            onClick={() => setTransError(null)}
            className="rcd-error-close"
          >
            ×
          </button>
        </div>
      )}

      {/* ── Two-column layout ──────────────────────────────── */}
      <div className="rcd-layout">
        {/* ── Left: Fields + History ── */}
        <div className="rcd-main">
          {/* Fields panel */}
          <div className="rcd-panel">
            <div className="rcd-panel-header">
              <div className="rcd-panel-title">
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
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                Details
              </div>
              {!editing && (
                <button
                  className="rcd-panel-action"
                  onClick={() => {
                    setEditValues(record.fields);
                    setCurrentState(record.currentState ?? "");
                    setEditing(true);
                    setSaveError(null);
                  }}
                >
                  Edit
                </button>
              )}
            </div>

            {fields.length === 0 ? (
              <p className="rcd-empty-hint">
                No fields defined for this record type.
              </p>
            ) : editing ? (
              <div className="rcd-edit-body">
                {saveError && (
                  <div
                    className="portal-alert-error"
                    style={{ marginBottom: "16px" }}
                  >
                    {saveError}
                  </div>
                )}
                <div className="portal-edit-grid">
                  {allStates.length > 0 && (
                    <div className="portal-field-group portal-field-full">
                      <label className="portal-field-label">State</label>
                      <select
                        className="portal-input"
                        value={currentState}
                        onChange={(e) => setCurrentState(e.target.value)}
                      >
                        {allStates.map((st) => (
                          <option key={st.id} value={st.name}>
                            {st.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {fields.map((f) => (
                    <div
                      key={f.id}
                      className={`portal-field-group ${f.fieldType === "longtext" ? "portal-field-full" : ""}`}
                    >
                      <label className="portal-field-label">
                        {f.label}
                        {f.isRequired && (
                          <span className="portal-required">*</span>
                        )}
                      </label>
                      <FieldInput
                        field={f}
                        value={editValues[f.name]}
                        onChange={(v) =>
                          setEditValues((p) => ({ ...p, [f.name]: v }))
                        }
                      />
                    </div>
                  ))}
                </div>
                <div className="rcd-edit-footer">
                  <button
                    className="portal-btn-secondary"
                    onClick={() => {
                      setEditing(false);
                      setSaveError(null);
                    }}
                    disabled={saving}
                  >
                    Cancel
                  </button>
                  <button
                    className="portal-btn-primary"
                    onClick={() => void saveEdit()}
                    disabled={saving}
                  >
                    {saving ? "Saving…" : "Save changes"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="rcd-fields">
                {fields.map((f) => (
                  <div key={f.id} className="rcd-field-row">
                    <div className="rcd-field-label">{f.label}</div>
                    <div className="rcd-field-value">
                      <FieldValue
                        value={record.fields[f.name]}
                        fieldType={f.fieldType}
                        field={f}
                      />
                    </div>
                  </div>
                ))}
                {fields.length === 0 && (
                  <p className="rcd-empty-hint">No custom fields.</p>
                )}
              </div>
            )}
          </div>

          {/* History timeline */}
          {history.length > 0 && (
            <div className="rcd-panel">
              <div className="rcd-panel-header">
                <div className="rcd-panel-title">
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
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  Activity
                  <span className="rcd-panel-count">{history.length}</span>
                </div>
              </div>
              <div className="rcd-timeline">
                {[...history].reverse().map((event) => {
                  const meta = event.metadata;
                  const isCreate = meta?.type === "create";
                  const isUpdate = meta?.type === "update";
                  const eventType = isCreate
                    ? "create"
                    : isUpdate
                      ? "update"
                      : "transition";

                  return (
                    <div key={event.id} className="rcd-tl-item">
                      <div className="rcd-tl-left">
                        <HistoryIcon type={eventType} />
                        <div className="rcd-tl-line" />
                      </div>
                      <div className="rcd-tl-body">
                        {isCreate ? (
                          <div className="rcd-tl-title">
                            Record created
                            <span className="rcd-tl-actor">
                              by {getActorName(event.actorId)}
                            </span>
                          </div>
                        ) : isUpdate ? (
                          <div>
                            <div className="rcd-tl-title">
                              Record updated
                              <span className="rcd-tl-actor">
                                by {getActorName(event.actorId)}
                              </span>
                            </div>
                            {"changed" in (meta as Record<string, unknown>) &&
                              typeof (meta as Record<string, unknown>)[
                                "changed"
                              ] === "object" &&
                              (meta as Record<string, unknown>)["changed"] !==
                                null &&
                              Object.keys(
                                (meta as Record<string, unknown>)[
                                  "changed"
                                ] as object,
                              ).length > 0 && (
                                <ul className="rcd-tl-changes">
                                  {Object.entries(
                                    (
                                      meta as Record<
                                        string,
                                        Record<string, Record<string, unknown>>
                                      >
                                    )["changed"] ?? {},
                                  ).map(([fieldName, change]) => (
                                    <li key={fieldName}>
                                      <strong>
                                        {getFieldLabel(fieldName)}
                                      </strong>
                                      : {String(change["old"] ?? "—")} →{" "}
                                      {String(change["new"] ?? "—")}
                                    </li>
                                  ))}
                                </ul>
                              )}
                          </div>
                        ) : (
                          <div className="rcd-tl-transition-row">
                            {event.fromState && (
                              <>
                                <span className="rcd-tl-state">
                                  {event.fromState}
                                </span>
                                <svg
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  className="rcd-tl-arrow"
                                >
                                  <polyline points="5 12 19 12" />
                                  <polyline points="13 6 19 12 13 18" />
                                </svg>
                              </>
                            )}
                            <span className="rcd-tl-state rcd-tl-state-to">
                              {event.toState}
                            </span>
                            <span className="rcd-tl-actor">
                              by {getActorName(event.actorId)}
                            </span>
                          </div>
                        )}
                        {event.comment && !isCreate && !isUpdate && (
                          <div className="rcd-tl-comment">
                            "{event.comment}"
                          </div>
                        )}
                        <div className="rcd-tl-time">
                          {new Date(event.triggeredAt).toLocaleString(
                            undefined,
                            {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            },
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Right sidebar ── */}
        <div className="rcd-sidebar">
          {/* Actions — available transitions */}
          <div className="rcd-panel rcd-panel-actions">
            <div className="rcd-panel-header">
              <div className="rcd-panel-title">
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
                  <polyline points="13 2 13 9 20 9" />
                  <path d="M19 14v6a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2h7" />
                </svg>
                Actions
              </div>
            </div>
            <div className="rcd-actions-body">
              {isTerminal ? (
                <div className="rcd-terminal-note">
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
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  This record is in a terminal state.
                </div>
              ) : availableTransitions.length === 0 ? (
                <div className="rcd-terminal-note">
                  No actions available for this state.
                </div>
              ) : (
                <div className="rcd-action-list">
                  {availableTransitions.map((t) => (
                    <button
                      key={t.id}
                      className="rcd-action-btn"
                      disabled={transitioning !== null}
                      onClick={() => {
                        if (t.requiresComment) {
                          setStateModal(t);
                        } else {
                          void executeTransition(t);
                        }
                      }}
                    >
                      {transitioning === t.id ? (
                        <span className="rcd-action-spinner" />
                      ) : (
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="5 12 19 12" />
                          <polyline points="13 6 19 12 13 18" />
                        </svg>
                      )}
                      <span>{t.label || `Move to ${t.toState}`}</span>
                      <span className="rcd-action-target">{t.toState}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Record info */}
          <div className="rcd-panel">
            <div className="rcd-panel-header">
              <div className="rcd-panel-title">
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
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                Info
              </div>
            </div>
            <div className="rcd-info-list">
              {[
                { label: "Record ID", value: record.id.slice(0, 8) + "…" },
                {
                  label: "Current State",
                  value: currentStateObj?.label ?? record.currentState ?? "—",
                },
                { label: "Type", value: entityType?.name ?? "—" },
                {
                  label: "Created",
                  value: new Date(record.createdAt).toLocaleDateString(),
                },
                {
                  label: "Last Updated",
                  value: new Date(record.updatedAt).toLocaleDateString(),
                },
              ].map((row) => (
                <div key={row.label} className="rcd-info-row">
                  <div className="rcd-info-label">{row.label}</div>
                  <div className="rcd-info-value">{row.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* State pipeline */}
          {allStates.length > 0 && (
            <div className="rcd-panel">
              <div className="rcd-panel-header">
                <div className="rcd-panel-title">
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
                    <path d="M3 8.689c0-.864.933-1.406 1.683-.977l7.108 4.061a1.125 1.125 0 010 1.954l-7.108 4.061A1.125 1.125 0 013 16.811V8.69zM12.75 8.689c0-.864.933-1.406 1.683-.977l7.108 4.061a1.125 1.125 0 010 1.954l-7.108 4.061a1.125 1.125 0 01-1.683-.977V8.69z" />
                  </svg>
                  Workflow States
                </div>
              </div>
              <div className="rcd-states-list">
                {allStates.map((s) => {
                  const isCurrent = s.name === record.currentState;
                  return (
                    <div
                      key={s.id}
                      className={`rcd-state-row ${isCurrent ? "rcd-state-row-current" : ""}`}
                    >
                      <span
                        className="rcd-state-pip"
                        style={{ background: s.color ?? "var(--accent)" }}
                      />
                      <span className="rcd-state-name">{s.label}</span>
                      {isCurrent && (
                        <span className="rcd-state-current-tag">current</span>
                      )}
                      {s.isTerminal && !isCurrent && (
                        <span className="rcd-state-end-tag">end</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Transition modal ─────────────────────────────────── */}
      {stateModal && (
        <div
          className="modal-overlay"
          onClick={() => {
            setStateModal(null);
            setComment("");
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">
                Move to "{stateModal.label || stateModal.toState}"
              </h3>
              <button
                className="modal-close"
                onClick={() => {
                  setStateModal(null);
                  setComment("");
                }}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <p className="rcd-modal-desc">
                This will transition the record from{" "}
                <strong>{record.currentState}</strong> to{" "}
                <strong>{stateModal.toState}</strong>.
              </p>
              <div className="form-group">
                <label className="form-label">
                  Comment {stateModal.requiresComment ? "*" : "(optional)"}
                </label>
                <textarea
                  className="form-input portal-textarea"
                  rows={3}
                  placeholder="Add a note about this transition…"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn-secondary"
                onClick={() => {
                  setStateModal(null);
                  setComment("");
                }}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                disabled={
                  (stateModal.requiresComment && !comment.trim()) ||
                  transitioning === stateModal.id
                }
                onClick={() =>
                  void executeTransition(stateModal, comment || undefined)
                }
              >
                {transitioning === stateModal.id ? "Moving…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
