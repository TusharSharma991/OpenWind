import React from "react";
import { Link } from "react-router-dom";
import { useEntityTypes, toTypeSlug } from "../entity-type-context.js";

export function Dashboard(): React.ReactElement {
  const { modules, entityTypes } = useEntityTypes();
  const installed = modules.filter((m) => m.installed);

  return (
    <div className="portal-page">
      <h1 className="portal-page-title">Home</h1>
      <p className="portal-page-subtitle">
        Your installed modules and quick access to records.
      </p>

      {installed.length === 0 ? (
        <div className="portal-empty">
          <p>
            No modules installed yet. Ask your administrator to install a
            module.
          </p>
        </div>
      ) : (
        <div className="portal-module-grid">
          {installed.map((mod) => {
            const types = entityTypes.filter((et) => et.moduleId === mod.id);
            return (
              <div key={mod.slug} className="portal-module-card">
                <div className="portal-module-header">
                  <h3 className="portal-module-name">{mod.name}</h3>
                  <span className="portal-badge-installed">Active</span>
                </div>
                {mod.description && (
                  <p className="portal-module-desc">{mod.description}</p>
                )}
                {types.length > 0 && (
                  <div className="portal-module-types">
                    {types.map((et) => (
                      <Link
                        key={et.id}
                        to={`/${toTypeSlug(et.plural || et.name)}`}
                        className="portal-type-link"
                      >
                        {et.icon && <span>{et.icon}</span>}
                        <span>{et.plural || et.name}</span>
                        <span className="portal-type-arrow">→</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
