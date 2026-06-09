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
    return <span className="portal-text-muted">—</span>;
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
    case "currency":
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

export function CustomerRecordDetail(): React.ReactElement {
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
        setFields(
          (fieldsRes as { data: EntityField[] }).data.filter(
            (f) => !f.isSystem,
          ),
        );
        setRecord((recRes as { data: EntityInstance }).data);
        setTransitions((transRes as { data?: Transition[] }).data ?? []);
        setHistory((histRes as { data?: WorkflowEvent[] }).data ?? []);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load"),
      )
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    void loadRecord();
  }, [entityTypeId, id]);

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

  function handleStateSelect(e: React.ChangeEvent<HTMLSelectElement>): void {
    const transitionId = e.target.value;
    if (!transitionId) return;
    const t = transitions.find((tr) => tr.id === transitionId);
    if (t) setStateModal(t);
    e.target.value = "";
  }

  if (loading)
    return (
      <div className="portal-loading">
        <div className="spinner" />
      </div>
    );
  if (error || !record) {
    return (
      <div className="portal-page">
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

  return (
    <div className="portal-page">
      <Link to={`/records/${typeSlug ?? ""}`} className="portal-back-link">
        ← {entityType?.plural ?? "Records"}
      </Link>

      <div className="portal-detail-header">
        <div>
          <h1 className="portal-page-title">
            {entityType?.name ?? "Record"}
            {record.currentState && (
              <span
                className="portal-state-badge"
                style={{ marginLeft: "12px", fontSize: "14px" }}
              >
                {record.currentState}
              </span>
            )}
          </h1>
          <p
            className="portal-text-muted"
            style={{ fontSize: "12px", marginTop: "4px" }}
          >
            Created {new Date(record.createdAt).toLocaleString()}
          </p>
        </div>

        <div className="portal-transitions">
          {transError && (
            <div className="portal-alert-error" style={{ marginBottom: "8px" }}>
              {transError}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <label
              className="portal-field-label"
              style={{ margin: 0, whiteSpace: "nowrap" }}
            >
              Move to:
            </label>
            {transitions.length > 0 ? (
              <select
                className="portal-input"
                style={{ minWidth: "180px" }}
                defaultValue=""
                onChange={handleStateSelect}
                disabled={transitioning !== null}
              >
                <option value="" disabled>
                  Select a state…
                </option>
                {transitions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label || t.toState}
                  </option>
                ))}
              </select>
            ) : (
              <span className="portal-text-muted" style={{ fontSize: "13px" }}>
                No state changes available
              </span>
            )}
            {transitioning && (
              <div
                className="spinner"
                style={{ width: "16px", height: "16px" }}
              />
            )}
          </div>
        </div>
      </div>

      <div className="portal-card">
        <div className="portal-card-header">
          <h3 className="portal-card-title">Details</h3>
          {!editing && (
            <button
              className="portal-btn-secondary portal-btn-sm"
              onClick={() => {
                setEditValues(record.fields);
                setEditing(true);
                setSaveError(null);
              }}
            >
              Edit
            </button>
          )}
        </div>
        {fields.length === 0 ? (
          <p className="portal-text-muted" style={{ padding: "18px" }}>
            No fields defined.
          </p>
        ) : editing ? (
          <div style={{ padding: "18px" }}>
            {saveError && (
              <div
                className="portal-alert-error"
                style={{ marginBottom: "16px" }}
              >
                {saveError}
              </div>
            )}
            <div className="portal-edit-grid">
              {fields.map((f) => (
                <div
                  key={f.id}
                  className={`portal-field-group ${f.fieldType === "longtext" ? "portal-field-full" : ""}`}
                >
                  <label className="portal-field-label">
                    {f.label}
                    {f.isRequired && <span className="portal-required">*</span>}
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
            <div className="portal-form-actions" style={{ marginTop: "20px" }}>
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
          <div className="portal-fields-grid">
            {fields.map((f) => (
              <div key={f.id} className="portal-field-row">
                <div className="portal-field-label-sm">{f.label}</div>
                <div className="portal-field-value">
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

      {history.length > 0 && (
        <div className="portal-card">
          <div className="portal-card-header">
            <h3 className="portal-card-title">History</h3>
          </div>
          <div className="portal-history">
            {history.map((event) => (
              <div key={event.id} className="portal-history-item">
                <div className="portal-history-dot" />
                <div className="portal-history-body">
                  <div className="portal-history-transition">
                    {event.fromState && (
                      <>
                        <span className="portal-state-badge portal-state-badge-sm">
                          {event.fromState}
                        </span>
                        <span
                          style={{ margin: "0 6px", color: "var(--text-3)" }}
                        >
                          →
                        </span>
                      </>
                    )}
                    <span className="portal-state-badge portal-state-badge-sm">
                      {event.toState}
                    </span>
                  </div>
                  {event.comment && (
                    <p className="portal-history-comment">{event.comment}</p>
                  )}
                  <p className="portal-history-meta">
                    {new Date(event.triggeredAt).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {stateModal && (
        <div
          className="portal-modal-overlay"
          onClick={() => {
            setStateModal(null);
            setComment("");
          }}
        >
          <div className="portal-modal" onClick={(e) => e.stopPropagation()}>
            <div className="portal-modal-header">
              <h3>Move to "{stateModal.label || stateModal.toState}"</h3>
              <button
                className="portal-modal-close"
                onClick={() => {
                  setStateModal(null);
                  setComment("");
                }}
              >
                ×
              </button>
            </div>
            <div className="portal-modal-body">
              <p
                style={{
                  marginBottom: "14px",
                  color: "var(--text-2)",
                  fontSize: "13px",
                }}
              >
                This will move the ticket from{" "}
                <strong style={{ color: "var(--text)" }}>
                  {record.currentState}
                </strong>{" "}
                to{" "}
                <strong style={{ color: "var(--text)" }}>
                  {stateModal.toState}
                </strong>
                .
              </p>
              <label className="portal-field-label">
                Comment {stateModal.requiresComment ? "*" : "(optional)"}
              </label>
              <textarea
                className="portal-input portal-textarea"
                rows={3}
                placeholder="Add a note…"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                autoFocus
              />
            </div>
            <div className="portal-modal-footer">
              <button
                className="portal-btn-secondary"
                onClick={() => {
                  setStateModal(null);
                  setComment("");
                }}
              >
                Cancel
              </button>
              <button
                className="portal-btn-primary"
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
