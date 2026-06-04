import React, { useEffect, useState } from "react";
import { useOne } from "@refinedev/core";
import { useParams, Link } from "react-router-dom";
import { fetchWithAuth, API_URL } from "../../lib/api.js";

type EntityType = {
  id: string;
  name: string;
  plural: string;
  icon: string | null;
  moduleId: string | null;
  allowCustomFields: boolean;
  createdAt: string;
};

type FieldConfig = {
  options?: string[];
  entityTypeId?: string;
  [key: string]: unknown;
};

type EntityField = {
  id: string;
  name: string;
  label: string;
  fieldType: string;
  config: FieldConfig;
  isRequired: boolean;
  isIndexed: boolean;
  isSystem: boolean;
  sortOrder: number;
  createdAt: string;
};

const FIELD_TYPE_STYLE: Record<string, { bg: string; color: string }> = {
  text: { bg: "hsla(210, 80%, 55%, 0.12)", color: "hsl(210, 80%, 72%)" },
  textarea: { bg: "hsla(250, 80%, 55%, 0.12)", color: "hsl(250, 80%, 72%)" },
  select: { bg: "hsla(280, 80%, 55%, 0.12)", color: "hsl(280, 80%, 72%)" },
  entity_ref: { bg: "hsla(30,  80%, 55%, 0.12)", color: "hsl(30,  80%, 72%)" },
  user_ref: { bg: "hsla(170, 70%, 45%, 0.12)", color: "hsl(170, 70%, 62%)" },
  number: { bg: "hsla(150, 70%, 45%, 0.12)", color: "hsl(150, 70%, 62%)" },
  boolean: { bg: "hsla(45,  90%, 55%, 0.12)", color: "hsl(45,  90%, 67%)" },
  date: { bg: "hsla(0,   70%, 55%, 0.12)", color: "hsl(0,   70%, 72%)" },
};

const FALLBACK_STYLE = {
  bg: "hsla(225, 20%, 40%, 0.12)",
  color: "var(--text-muted)",
};

export function EntityTypeDetail(): React.ReactElement {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading } = useOne<EntityType>({
    resource: "entity-types",
    id: id ?? "missing",
  });

  const [fields, setFields] = useState<EntityField[]>([]);
  const [fieldsLoading, setFieldsLoading] = useState(true);
  const [fieldsError, setFieldsError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setFieldsLoading(true);
    setFieldsError(null);
    fetchWithAuth(`${API_URL}/entity-types/${id}/fields`)
      .then((res) => {
        // API returns { data: EntityField[] }
        const result = res as { data: EntityField[] };
        setFields(result.data);
      })
      .catch((err: unknown) => {
        setFieldsError(
          err instanceof Error ? err.message : "Failed to load fields",
        );
        setFields([]);
      })
      .finally(() => setFieldsLoading(false));
  }, [id]);

  const entityType = data?.data;
  const sortedFields = [...fields].sort((a, b) => a.sortOrder - b.sortOrder);
  const selectFields = sortedFields.filter((f) => f.fieldType === "select");

  if (isLoading) {
    return (
      <div className="loading-center">
        <div className="spinner" />
        <span className="loader-text">Loading…</span>
      </div>
    );
  }

  if (!entityType) {
    return (
      <div className="empty-state">
        <h4>Entity type not found</h4>
        <Link
          to="/entity-types"
          className="back-link"
          style={{ marginTop: "12px", display: "inline-block" }}
        >
          ← Back to Entity Types
        </Link>
      </div>
    );
  }

  return (
    <div>
      <Link to="/entity-types" className="back-link">
        ← Entity Types
      </Link>

      {/* Detail header */}
      <div className="detail-header">
        {entityType.icon ? (
          <span className="detail-icon">{entityType.icon}</span>
        ) : (
          <div className="detail-icon-placeholder">
            {entityType.name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div>
          <h2 className="page-title" style={{ marginBottom: "6px" }}>
            {entityType.name}
          </h2>
          <div
            style={{
              display: "flex",
              gap: "8px",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <span style={{ color: "var(--text-muted)", fontSize: "13px" }}>
              plural:{" "}
              <span style={{ color: "var(--text-secondary)" }}>
                {entityType.plural}
              </span>
            </span>
            {entityType.moduleId && (
              <span className="badge badge-primary">{entityType.moduleId}</span>
            )}
            {entityType.allowCustomFields && (
              <span className="badge badge-success">Custom Fields Allowed</span>
            )}
            <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>
              Created {new Date(entityType.createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>
      </div>

      {/* Fields panel */}
      <div className="data-panel">
        <div className="panel-header">
          <h3 className="panel-title">Fields</h3>
          <span className="badge badge-muted">{fields.length} fields</span>
        </div>

        {fieldsLoading ? (
          <div style={{ padding: "32px", textAlign: "center" }}>
            <div className="spinner" style={{ margin: "0 auto" }} />
          </div>
        ) : fieldsError ? (
          <div className="alert alert-error">{fieldsError}</div>
        ) : sortedFields.length === 0 ? (
          <div className="empty-state-inline">
            No fields defined for this entity type.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: "40px" }}>#</th>
                <th>Label</th>
                <th>Field Name</th>
                <th>Type</th>
                <th>Required</th>
                <th>Indexed</th>
                <th>System</th>
              </tr>
            </thead>
            <tbody>
              {sortedFields.map((field) => {
                const style =
                  FIELD_TYPE_STYLE[field.fieldType] ?? FALLBACK_STYLE;
                return (
                  <tr key={field.id}>
                    <td
                      style={{ color: "var(--text-muted)", fontSize: "12px" }}
                    >
                      {field.sortOrder}
                    </td>
                    <td style={{ fontWeight: 500 }}>{field.label}</td>
                    <td>
                      <code className="code-inline">{field.name}</code>
                    </td>
                    <td>
                      <span
                        className="badge"
                        style={{
                          backgroundColor: style.bg,
                          color: style.color,
                          border: `1px solid ${style.color}30`,
                        }}
                      >
                        {field.fieldType}
                      </span>
                    </td>
                    <td>
                      {field.isRequired ? (
                        <span className="badge badge-warning">Required</span>
                      ) : (
                        <span className="text-muted-sm">—</span>
                      )}
                    </td>
                    <td>
                      {field.isIndexed ? (
                        <span className="badge badge-success">Yes</span>
                      ) : (
                        <span className="text-muted-sm">—</span>
                      )}
                    </td>
                    <td>
                      {field.isSystem ? (
                        <span className="badge badge-muted">System</span>
                      ) : (
                        <span className="text-muted-sm">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Select field options */}
      {selectFields.length > 0 && (
        <div className="data-panel">
          <div className="panel-header">
            <h3 className="panel-title">Select Field Options</h3>
          </div>
          <div
            style={{ display: "flex", flexDirection: "column", gap: "16px" }}
          >
            {selectFields.map((f) => {
              const opts = f.config.options ?? [];
              return (
                <div key={f.id}>
                  <div
                    style={{
                      fontSize: "13px",
                      color: "var(--text-secondary)",
                      fontWeight: 500,
                      marginBottom: "8px",
                    }}
                  >
                    {f.label}{" "}
                    <code className="code-inline" style={{ marginLeft: "6px" }}>
                      {f.name}
                    </code>
                  </div>
                  <div
                    style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}
                  >
                    {opts.map((opt) => (
                      <span key={opt} className="badge badge-muted">
                        {opt}
                      </span>
                    ))}
                    {opts.length === 0 && (
                      <span className="text-muted-sm">
                        No options configured
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
