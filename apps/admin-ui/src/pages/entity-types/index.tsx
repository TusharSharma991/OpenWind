import React from "react";
import { useList } from "@refinedev/core";
import { useNavigate } from "react-router-dom";

type EntityType = {
  id: string;
  name: string;
  plural: string;
  icon: string | null;
  moduleId: string | null;
  allowCustomFields: boolean;
  createdAt: string;
};

export function EntityTypes(): React.ReactElement {
  const { data, isLoading } = useList<EntityType>({ resource: "entity-types" });
  const navigate = useNavigate();
  const types = data?.data ?? [];

  const byModule = types.reduce<Record<string, EntityType[]>>((acc, t) => {
    const key = t.moduleId ?? "__custom__";
    (acc[key] ??= []).push(t);
    return acc;
  }, {});

  if (isLoading) {
    return (
      <div className="loading-center">
        <div className="spinner" />
        <span className="loader-text">Loading entity types…</span>
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "28px",
        }}
      >
        <div>
          <h2 className="page-title">Entity Types</h2>
          <p className="page-subtitle">
            All configurable object schemas in the platform. Entity types define
            the structure, fields, and workflows for every record.
          </p>
        </div>
        <div className="stat-pill">{types.length} types</div>
      </div>

      {types.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">◻</div>
          <h4>No entity types defined</h4>
          <p>Install a module or create a custom entity type to get started.</p>
        </div>
      ) : (
        <div className="data-panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Plural</th>
                <th>Module</th>
                <th>Custom Fields</th>
                <th>Created</th>
                <th style={{ width: "40px" }}></th>
              </tr>
            </thead>
            <tbody>
              {types.map((type) => (
                <tr
                  key={type.id}
                  className="table-row-clickable"
                  onClick={() => navigate(`/entity-types/${type.id}`)}
                >
                  <td>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                      }}
                    >
                      {type.icon ? (
                        <span style={{ fontSize: "18px", lineHeight: 1 }}>
                          {type.icon}
                        </span>
                      ) : (
                        <div className="type-icon-placeholder">
                          {type.name.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <span style={{ fontWeight: 600 }}>{type.name}</span>
                    </div>
                  </td>
                  <td style={{ color: "var(--text-secondary)" }}>
                    {type.plural}
                  </td>
                  <td>
                    {type.moduleId ? (
                      <span className="badge badge-primary">
                        {type.moduleId}
                      </span>
                    ) : (
                      <span
                        style={{ color: "var(--text-muted)", fontSize: "13px" }}
                      >
                        custom
                      </span>
                    )}
                  </td>
                  <td>
                    <span
                      className={`badge ${type.allowCustomFields ? "badge-success" : "badge-muted"}`}
                    >
                      {type.allowCustomFields ? "Yes" : "No"}
                    </span>
                  </td>
                  <td style={{ color: "var(--text-muted)", fontSize: "13px" }}>
                    {new Date(type.createdAt).toLocaleDateString()}
                  </td>
                  <td>
                    <button
                      className="btn-icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/entity-types/${type.id}`);
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

      {/* Group summary */}
      {Object.keys(byModule).length > 1 && (
        <div
          style={{
            marginTop: "24px",
            display: "flex",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          {Object.entries(byModule).map(([mod, items]) => (
            <div key={mod} className="module-summary-chip">
              <span className="badge badge-primary">
                {mod === "__custom__" ? "custom" : mod}
              </span>
              <span
                style={{
                  fontSize: "12px",
                  color: "var(--text-muted)",
                  marginLeft: "6px",
                }}
              >
                {items.length} types
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
