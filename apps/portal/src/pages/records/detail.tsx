import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { fetchWithAuth, API_URL } from "../../auth.js";
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
type Transition = {
  id: string;
  fromState: string;
  toState: string;
  label: string;
  requiresComment: boolean;
};
type WorkflowEvent = {
  id: string;
  fromState: string | null;
  toState: string;
  actorId: string;
  comment: string | null;
  triggeredAt: string;
};

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
    return <span className="rd-muted">—</span>;
  if (fieldType === "boolean") {
    const bv = Boolean(value);
    return (
      <span className={`rd-bool ${bv ? "rd-bool--yes" : "rd-bool--no"}`}>
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
        className="rd-enum"
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
        <label className="rd-checkbox">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>{field.label}</span>
        </label>
      );
    case "number":
    case "currency":
      return (
        <input
          className="rd-input"
          type="number"
          value={strVal}
          onChange={(e) =>
            onChange(e.target.value === "" ? null : Number(e.target.value))
          }
        />
      );
    case "date":
      return (
        <input
          className="rd-input"
          type="date"
          value={strVal}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    case "datetime":
      return (
        <input
          className="rd-input"
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
          className="rd-input"
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
          className="rd-input rd-textarea"
          value={strVal}
          rows={4}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    default:
      return (
        <input
          className="rd-input"
          type="text"
          value={strVal}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
  }
}

function StateChip({ state }: { state: string | null }): React.ReactElement {
  if (!state) return <span className="rd-muted">No state</span>;
  const lower = state.toLowerCase();
  let mod = "";
  if (
    lower.includes("open") ||
    lower.includes("new") ||
    lower.includes("active")
  )
    mod = "rd-state--open";
  else if (
    lower.includes("done") ||
    lower.includes("closed") ||
    lower.includes("resolved") ||
    lower.includes("complete")
  )
    mod = "rd-state--done";
  else if (
    lower.includes("progress") ||
    lower.includes("review") ||
    lower.includes("pending")
  )
    mod = "rd-state--progress";
  return <span className={`rd-state-chip ${mod}`}>{state}</span>;
}

export function RecordDetail(): React.ReactElement {
  const { typeSlug, id } = useParams<{ typeSlug: string; id: string }>();
  const { getTypeBySlug } = useEntityTypes();

  const entityType = typeSlug ? getTypeBySlug(typeSlug) : undefined;
  const entityTypeId = entityType?.id;

  const [fields, setFields] = useState<EntityField[]>([]);
  const [record, setRecord] = useState<EntityInstance | null>(null);
  const [transitions, setTransitions] = useState<Transition[]>([]);
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

  function loadRecord(): Promise<void> {
    if (!entityTypeId || !id) return Promise.resolve();
    return Promise.all([
      fetchWithAuth(`${API_URL}/entity-types/${entityTypeId}/fields`),
      fetchWithAuth(`${API_URL}/entities/${id}`),
      fetchWithAuth(`${API_URL}/entities/${id}/transitions`),
      fetchWithAuth(`${API_URL}/entities/${id}/transitions/history`).catch(
        () => ({ data: [] }),
      ),
    ])
      .then(([fieldsRes, recRes, transRes, histRes]) => {
        const fs = (fieldsRes as { data: EntityField[] }).data.filter(
          (f) => !f.isSystem,
        );
        setFields(fs);
        const rec = (recRes as { data: EntityInstance }).data;
        setRecord(rec);
        setTransitions((transRes as { data?: Transition[] }).data ?? []);
        setHistory((histRes as { data?: WorkflowEvent[] }).data ?? []);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    void loadRecord();
  }, [entityTypeId, id]);

  function startEdit(): void {
    setEditValues(record?.fields ?? {});
    setEditing(true);
    setSaveError(null);
  }

  function cancelEdit(): void {
    setEditing(false);
    setSaveError(null);
  }

  async function saveEdit(): Promise<void> {
    if (!id) return;
    setSaving(true);
    setSaveError(null);
    try {
      await fetchWithAuth(`${API_URL}/entities/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ fields: editValues }),
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

  if (loading) {
    return (
      <div className="portal-loading">
        <div className="spinner" />
      </div>
    );
  }

  if (error || !record) {
    return (
      <div className="portal-page">
        <div className="portal-alert-error">{error ?? "Record not found"}</div>
        <Link
          to={`/${typeSlug ?? ""}`}
          className="rd-back"
          style={{ marginTop: "12px", display: "inline-flex" }}
        >
          ← Back
        </Link>
      </div>
    );
  }

  const createdDate = new Date(record.createdAt).toLocaleString();
  const updatedDate = new Date(record.updatedAt).toLocaleString();

  return (
    <div className="portal-page rd-page">
      {/* ── Breadcrumb ── */}
      <Link to={`/${typeSlug ?? ""}`} className="rd-back">
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
          <polyline points="15 18 9 12 15 6" />
        </svg>
        {entityType?.plural ?? "Records"}
      </Link>

      {/* ── Page header ── */}
      <div className="rd-header">
        <div className="rd-header-accent" />
        <div className="rd-header-main">
          <div className="rd-header-top">
            <h1 className="rd-title">{entityType?.name ?? "Record"}</h1>
            <StateChip state={record.currentState} />
          </div>
          <p className="rd-meta">
            Created {createdDate}
            {record.updatedAt !== record.createdAt && (
              <> · Updated {updatedDate}</>
            )}
          </p>
        </div>
      </div>

      {/* ── Two-column body ── */}
      <div className="rd-body">
        {/* ── Main column ── */}
        <div className="rd-main-col">
          {/* Details card */}
          <div className="rd-card">
            <div className="rd-card-head">
              <span className="rd-card-title">Details</span>
              {!editing && (
                <button className="rd-btn-edit" onClick={startEdit}>
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
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  Edit
                </button>
              )}
            </div>

            {fields.length === 0 ? (
              <p className="rd-muted" style={{ padding: "18px" }}>
                No fields defined.
              </p>
            ) : editing ? (
              <div className="rd-edit-body">
                {saveError && (
                  <div
                    className="portal-alert-error"
                    style={{ marginBottom: "16px" }}
                  >
                    {saveError}
                  </div>
                )}
                <div className="rd-edit-grid">
                  {fields.map((f) => (
                    <div
                      key={f.id}
                      className={`rd-field-group ${f.fieldType === "longtext" ? "rd-field-full" : ""}`}
                    >
                      <label className="rd-field-label">
                        {f.label}
                        {f.isRequired && <span className="rd-required">*</span>}
                      </label>
                      <FieldInput
                        field={f}
                        value={editValues[f.name]}
                        onChange={(v) =>
                          setEditValues((prev) => ({ ...prev, [f.name]: v }))
                        }
                      />
                    </div>
                  ))}
                </div>
                <div className="rd-edit-actions">
                  <button
                    className="rd-btn-cancel"
                    onClick={cancelEdit}
                    disabled={saving}
                  >
                    Cancel
                  </button>
                  <button
                    className="rd-btn-save"
                    onClick={() => void saveEdit()}
                    disabled={saving}
                  >
                    {saving ? "Saving…" : "Save changes"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="rd-fields-grid">
                {fields.map((f) => (
                  <div key={f.id} className="rd-field-cell">
                    <div className="rd-field-key">{f.label}</div>
                    <div className="rd-field-val">
                      <FieldValue
                        value={record.fields[f.name]}
                        fieldType={f.fieldType}
                        field={f}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* History card */}
          {history.length > 0 && (
            <div className="rd-card">
              <div className="rd-card-head">
                <span className="rd-card-title">Activity</span>
              </div>
              <div className="rd-timeline">
                {history.map((event, idx) => (
                  <div
                    key={event.id}
                    className={`rd-tl-item ${idx === history.length - 1 ? "rd-tl-last" : ""}`}
                  >
                    <div className="rd-tl-spine">
                      <div className="rd-tl-dot" />
                      {idx < history.length - 1 && (
                        <div className="rd-tl-line" />
                      )}
                    </div>
                    <div className="rd-tl-body">
                      <div className="rd-tl-states">
                        {event.fromState && (
                          <>
                            <span className="rd-tl-badge">
                              {event.fromState}
                            </span>
                            <span className="rd-tl-arrow">→</span>
                          </>
                        )}
                        <span className="rd-tl-badge rd-tl-badge--to">
                          {event.toState}
                        </span>
                      </div>
                      {event.comment && (
                        <p className="rd-tl-comment">"{event.comment}"</p>
                      )}
                      <p className="rd-tl-time">
                        {new Date(event.triggeredAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Sidebar column ── */}
        <div className="rd-side-col">
          {/* Status & transitions */}
          <div className="rd-card rd-side-card">
            <div className="rd-card-head">
              <span className="rd-card-title">Status</span>
            </div>
            <div className="rd-status-body">
              <div className="rd-status-current">
                <span className="rd-status-label">Current state</span>
                <StateChip state={record.currentState} />
              </div>

              {transError && (
                <div
                  className="portal-alert-error"
                  style={{ marginBottom: "10px", fontSize: "12px" }}
                >
                  {transError}
                </div>
              )}

              {transitions.length > 0 && (
                <div className="rd-transitions">
                  <span className="rd-transitions-label">Move to</span>
                  <div className="rd-trans-list">
                    {transitions.map((t) => (
                      <button
                        key={t.id}
                        className="rd-trans-btn"
                        disabled={transitioning !== null}
                        onClick={() => setStateModal(t)}
                      >
                        {transitioning === t.id ? (
                          <span
                            className="spinner"
                            style={{
                              width: "12px",
                              height: "12px",
                              borderWidth: "2px",
                            }}
                          />
                        ) : (
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        )}
                        {t.label || t.toState}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {transitions.length === 0 && (
                <p
                  className="rd-muted"
                  style={{ fontSize: "12px", marginTop: "8px" }}
                >
                  No transitions available
                </p>
              )}
            </div>
          </div>

          {/* Record metadata */}
          <div className="rd-card rd-side-card">
            <div className="rd-card-head">
              <span className="rd-card-title">Info</span>
            </div>
            <div className="rd-meta-grid">
              <div className="rd-meta-row">
                <span className="rd-meta-key">Record ID</span>
                <span className="rd-meta-val rd-id">{id?.slice(0, 8)}…</span>
              </div>
              <div className="rd-meta-row">
                <span className="rd-meta-key">Created</span>
                <span className="rd-meta-val">
                  {new Date(record.createdAt).toLocaleDateString()}
                </span>
              </div>
              <div className="rd-meta-row">
                <span className="rd-meta-key">Last updated</span>
                <span className="rd-meta-val">
                  {new Date(record.updatedAt).toLocaleDateString()}
                </span>
              </div>
              {record.assignedTo && (
                <div className="rd-meta-row">
                  <span className="rd-meta-key">Assigned to</span>
                  <span className="rd-meta-val">{record.assignedTo}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Transition confirmation modal ── */}
      {stateModal && (
        <div
          className="portal-modal-overlay"
          onClick={() => {
            setStateModal(null);
            setComment("");
          }}
        >
          <div className="rd-modal" onClick={(e) => e.stopPropagation()}>
            <div className="rd-modal-head">
              <h3 className="rd-modal-title">
                Move to "{stateModal.label || stateModal.toState}"
              </h3>
              <button
                className="rd-modal-close"
                onClick={() => {
                  setStateModal(null);
                  setComment("");
                }}
              >
                ×
              </button>
            </div>
            <div className="rd-modal-body">
              <div className="rd-modal-states">
                <span className="rd-tl-badge">{record.currentState}</span>
                <span className="rd-tl-arrow">→</span>
                <span className="rd-tl-badge rd-tl-badge--to">
                  {stateModal.toState}
                </span>
              </div>
              <label
                className="rd-field-label"
                style={{ marginTop: "16px", display: "block" }}
              >
                Comment{" "}
                {stateModal.requiresComment ? (
                  <span className="rd-required">*</span>
                ) : (
                  <span className="rd-muted">(optional)</span>
                )}
              </label>
              <textarea
                className="rd-input rd-textarea"
                rows={3}
                placeholder="Add a note about this change…"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                autoFocus
              />
            </div>
            <div className="rd-modal-foot">
              <button
                className="rd-btn-cancel"
                onClick={() => {
                  setStateModal(null);
                  setComment("");
                }}
              >
                Cancel
              </button>
              <button
                className="rd-btn-save"
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
