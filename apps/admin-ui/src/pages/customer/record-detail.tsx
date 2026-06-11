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
type WorkflowEvent = {
  id: string;
  fromState: string | null;
  toState: string;
  actorId: string;
  comment: string | null;
  triggeredAt: string;
  metadata?: Record<string, unknown>;
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
  const [allStates, setAllStates] = useState<
    Array<{ id: string; name: string; label: string }>
  >([]);
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
    return u?.displayName ?? u?.email ?? actorId;
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
    if (record?.workflowId) {
      fetchWithAuth(`${API_URL}/workflows/${record.workflowId}`)
        .then((res) => {
          const wf = (
            res as {
              data: {
                states: Array<{ id: string; name: string; label: string }>;
              };
            }
          ).data;
          setAllStates(wf.states);
        })
        .catch(() => undefined);
    } else if (entityTypeId) {
      fetchWithAuth(`${API_URL}/workflows?entityTypeId=${entityTypeId}`)
        .then((res) => {
          const wfs =
            (
              res as {
                data?: Array<{
                  states?: Array<{ id: string; name: string; label: string }>;
                }>;
              }
            ).data ?? [];
          if (wfs[0]?.states) {
            setAllStates(wfs[0].states);
          } else {
            setAllStates([]);
          }
        })
        .catch(() => setAllStates([]));
    } else {
      setAllStates([]);
    }
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
            <div className="portal-field-row">
              <div className="portal-field-label-sm">State</div>
              <div className="portal-field-value">
                {record.currentState ? (
                  <span className="portal-state-badge">
                    {record.currentState}
                  </span>
                ) : (
                  <span className="portal-text-muted">—</span>
                )}
              </div>
            </div>
            <div className="portal-field-row">
              <div className="portal-field-label-sm">Created At</div>
              <div className="portal-field-value">
                {new Date(record.createdAt).toLocaleString()}
              </div>
            </div>
            <div className="portal-field-row">
              <div className="portal-field-label-sm">Updated At</div>
              <div className="portal-field-value">
                {new Date(record.updatedAt).toLocaleString()}
              </div>
            </div>
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
            {history.map((event) => {
              const meta = event.metadata;
              const isCreate = meta?.type === "create";
              const isUpdate = meta?.type === "update";

              return (
                <div key={event.id} className="portal-history-item">
                  <div className="portal-history-dot" />
                  <div className="portal-history-body">
                    {isCreate ? (
                      <div style={{ fontWeight: 600, color: "var(--text)" }}>
                        🆕 Record created{" "}
                        <span
                          style={{
                            fontWeight: 400,
                            color: "var(--text-3)",
                            marginLeft: "4px",
                          }}
                        >
                          by {getActorName(event.actorId)}
                        </span>
                      </div>
                    ) : isUpdate ? (
                      <div>
                        <div
                          style={{
                            fontWeight: 600,
                            color: "var(--text)",
                            marginBottom: "4px",
                          }}
                        >
                          ✏️ Record updated{" "}
                          <span
                            style={{
                              fontWeight: 400,
                              color: "var(--text-3)",
                              marginLeft: "4px",
                            }}
                          >
                            by {getActorName(event.actorId)}
                          </span>
                        </div>
                        {"changed" in meta &&
                        typeof meta["changed"] === "object" &&
                        meta["changed"] !== null &&
                        Object.keys(meta["changed"] as object).length > 0 ? (
                          <ul
                            style={{
                              margin: "4px 0 0 16px",
                              padding: 0,
                              fontSize: "12px",
                              color: "var(--text-2)",
                            }}
                          >
                            {Object.entries(
                              meta.changed as Record<
                                string,
                                Record<string, unknown>
                              >,
                            ).map(([fieldName, change]) => (
                              <li
                                key={fieldName}
                                style={{ listStyleType: "disc" }}
                              >
                                <strong>{getFieldLabel(fieldName)}</strong>:
                                changed from{" "}
                                <em>{String(change["old"] ?? "—")}</em> to{" "}
                                <em>{String(change["new"] ?? "—")}</em>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : (
                      <div className="portal-history-transition">
                        {event.fromState && (
                          <>
                            <span className="portal-state-badge portal-state-badge-sm">
                              {event.fromState}
                            </span>
                            <span
                              style={{
                                margin: "0 6px",
                                color: "var(--text-3)",
                              }}
                            >
                              →
                            </span>
                          </>
                        )}
                        <span className="portal-state-badge portal-state-badge-sm">
                          {event.toState}
                        </span>
                        <span
                          style={{
                            marginLeft: "8px",
                            fontSize: "12px",
                            color: "var(--text-3)",
                          }}
                        >
                          by {getActorName(event.actorId)}
                        </span>
                      </div>
                    )}
                    {event.comment && !isCreate && !isUpdate && (
                      <p className="portal-history-comment">{event.comment}</p>
                    )}
                    <p className="portal-history-meta">
                      {new Date(event.triggeredAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              );
            })}
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
