import React, { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { fetchWithAuth, API_URL } from "../../lib/api.js";
import { useEntityTypes } from "../../entity-type-context.js";

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
  updatedAt: string;
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

export function CustomerRecordList(): React.ReactElement {
  const { typeSlug } = useParams<{ typeSlug: string }>();
  const navigate = useNavigate();
  const { getTypeBySlug } = useEntityTypes();

  const entityType = typeSlug ? getTypeBySlug(typeSlug) : undefined;
  const entityTypeId = entityType?.id;

  const [fields, setFields] = useState<EntityField[]>([]);
  const [records, setRecords] = useState<EntityInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entityTypeId) return;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchWithAuth(`${API_URL}/entity-types/${entityTypeId}/fields`),
      fetchWithAuth(`${API_URL}/entities?entityTypeId=${entityTypeId}`),
    ])
      .then(([fieldsRes, recRes]) => {
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
  }, [entityTypeId]);

  const visibleFields = fields.slice(0, 4);
  const slug = typeSlug ?? "";

  if (!entityType && !loading) {
    return (
      <div className="portal-page">
        <div className="portal-alert-error">Entity type not found.</div>
      </div>
    );
  }

  if (loading)
    return (
      <div className="portal-loading">
        <div className="spinner" />
      </div>
    );
  if (error)
    return (
      <div className="portal-page">
        <div className="portal-alert-error">{error}</div>
      </div>
    );

  return (
    <div className="portal-page">
      <div className="portal-page-header">
        <div>
          <h1 className="portal-page-title">
            {entityType?.icon && (
              <span style={{ marginRight: "8px" }}>{entityType.icon}</span>
            )}
            {entityType?.plural ?? "Records"}
          </h1>
          <p className="portal-page-subtitle">{records.length} records</p>
        </div>
        <Link to={`/records/${slug}/new`} className="portal-btn-primary">
          + New {entityType?.name}
        </Link>
      </div>

      {records.length === 0 ? (
        <div className="portal-empty">
          <p>No {(entityType?.plural ?? "Records").toLowerCase()} yet.</p>
          <Link
            to={`/records/${slug}/new`}
            className="portal-btn-primary"
            style={{ marginTop: "16px" }}
          >
            Create the first one
          </Link>
        </div>
      ) : (
        <div className="portal-table-wrap">
          <table className="portal-table">
            <thead>
              <tr>
                <th>State</th>
                {visibleFields.map((f) => (
                  <th key={f.id}>{f.label}</th>
                ))}
                <th>Created</th>
                <th style={{ width: "40px" }} />
              </tr>
            </thead>
            <tbody>
              {records.map((rec) => (
                <tr
                  key={rec.id}
                  className="portal-table-row"
                  onClick={() => navigate(`/records/${slug}/${rec.id}`)}
                >
                  <td>
                    {rec.currentState ? (
                      <span className="portal-state-badge">
                        {rec.currentState}
                      </span>
                    ) : (
                      <span className="portal-text-muted">—</span>
                    )}
                  </td>
                  {visibleFields.map((f) => (
                    <td key={f.id} className="portal-cell">
                      {fieldDisplay(rec.fields[f.name], f.fieldType)}
                    </td>
                  ))}
                  <td
                    className="portal-text-muted"
                    style={{ fontSize: "13px" }}
                  >
                    {new Date(rec.createdAt).toLocaleDateString()}
                  </td>
                  <td>
                    <button
                      className="portal-btn-icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/records/${slug}/${rec.id}`);
                      }}
                    >
                      →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
