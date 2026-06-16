import React, { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { fetchWithAuth, API_URL } from "../../auth.js";
import { useEntityTypes } from "../../entity-type-context.js";

type EntityField = {
  id: string;
  name: string;
  label: string;
  fieldType: string;
  isRequired: boolean;
  isSystem: boolean;
  config: {
    options?: Array<string | { label: string; value: string; color?: string }>;
  };
};
type WorkflowDef = { id: string; name: string };

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
          required={field.isRequired}
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
          required={field.isRequired}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    case "datetime":
      return (
        <input
          className="portal-input"
          type="datetime-local"
          value={strVal}
          required={field.isRequired}
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
          required={field.isRequired}
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
          required={field.isRequired}
          onChange={(e) => onChange(e.target.value || null)}
          rows={4}
        />
      );
    default:
      return (
        <input
          className="portal-input"
          type="text"
          value={strVal}
          required={field.isRequired}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
  }
}

export function RecordCreate(): React.ReactElement {
  const { typeSlug } = useParams<{ typeSlug: string }>();
  const navigate = useNavigate();
  const { getTypeBySlug } = useEntityTypes();

  const entityType = typeSlug ? getTypeBySlug(typeSlug) : undefined;
  const entityTypeId = entityType?.id;

  const [fields, setFields] = useState<EntityField[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({});
  const [workflowId, setWorkflowId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!entityTypeId) return;
    Promise.all([
      fetchWithAuth(`${API_URL}/entity-types/${entityTypeId}/fields`),
      fetchWithAuth(`${API_URL}/workflows?entityTypeId=${entityTypeId}`),
    ])
      .then(([fieldsRes, wfRes]) => {
        const fs = (fieldsRes as { data: EntityField[] }).data.filter(
          (f) => !f.isSystem,
        );
        setFields(fs);
        const wfs = (wfRes as { data?: WorkflowDef[] }).data ?? [];
        setWorkflows(wfs);
        if (wfs.length === 1 && wfs[0]) setWorkflowId(wfs[0].id);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load"),
      )
      .finally(() => setLoading(false));
  }, [entityTypeId]);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!entityTypeId || !typeSlug) return;
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        entityTypeId,
        fields: fieldValues,
      };
      if (workflowId) payload["workflowId"] = workflowId;
      const res = await fetchWithAuth(`${API_URL}/entities`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const created = (res as { data: { id: string } }).data;
      navigate(`/${typeSlug}/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="portal-loading">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="portal-page">
      <Link to={`/${typeSlug ?? ""}`} className="portal-back-link">
        ← {entityType?.plural ?? "Records"}
      </Link>
      <h1 className="portal-page-title">New {entityType?.name}</h1>

      <form onSubmit={(e) => void handleSubmit(e)} className="portal-form">
        {error && <div className="portal-alert-error">{error}</div>}

        {workflows.length > 1 && (
          <div className="portal-field-group">
            <label className="portal-field-label">Workflow</label>
            <select
              className="portal-input"
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
            >
              <option value="">No workflow</option>
              {workflows.map((wf) => (
                <option key={wf.id} value={wf.id}>
                  {wf.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {fields.map((field) => (
          <div key={field.id} className="portal-field-group">
            <label className="portal-field-label">
              {field.label}
              {field.isRequired && <span className="portal-required">*</span>}
            </label>
            <FieldInput
              field={field}
              value={fieldValues[field.name]}
              onChange={(v) =>
                setFieldValues((prev) => ({ ...prev, [field.name]: v }))
              }
            />
          </div>
        ))}

        {fields.length === 0 && (
          <p className="portal-text-muted" style={{ marginBottom: "16px" }}>
            No fields defined for this entity type.
          </p>
        )}

        <div className="portal-form-actions">
          <Link to={`/${typeSlug ?? ""}`} className="portal-btn-secondary">
            Cancel
          </Link>
          <button
            type="submit"
            className="portal-btn-primary"
            disabled={saving}
          >
            {saving ? "Creating…" : `Create ${entityType?.name ?? "Record"}`}
          </button>
        </div>
      </form>
    </div>
  );
}
