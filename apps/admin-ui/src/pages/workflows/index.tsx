import React from "react";
import { useList } from "@refinedev/core";
import { useNavigate } from "react-router-dom";

type Workflow = {
  id: string;
  name: string;
  entityTypeId: string;
  initialState: string;
  createdAt: string;
};

export function Workflows(): React.ReactElement {
  const { data, isLoading } = useList<Workflow>({ resource: "workflows" });
  const navigate = useNavigate();
  const workflows = data?.data ?? [];

  if (isLoading) {
    return (
      <div className="loading-center">
        <div className="spinner" />
        <span className="loader-text">Loading workflows…</span>
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
          <h2 className="page-title">Workflows</h2>
          <p className="page-subtitle">
            State machine definitions for entity types. Each workflow governs
            states, transitions, SLA timers, and role-based guards.
          </p>
        </div>
        <div className="stat-pill">{workflows.length} workflows</div>
      </div>

      {workflows.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">⟳</div>
          <h4>No workflows defined</h4>
          <p>Install a module or define a workflow on an entity type.</p>
        </div>
      ) : (
        <div className="data-panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Entity Type</th>
                <th>Initial State</th>
                <th>Created</th>
                <th style={{ width: "40px" }}></th>
              </tr>
            </thead>
            <tbody>
              {workflows.map((wf) => (
                <tr
                  key={wf.id}
                  className="table-row-clickable"
                  onClick={() => navigate(`/workflows/${wf.id}`)}
                >
                  <td>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      <div className="workflow-icon">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth="2"
                          stroke="currentColor"
                          width="14"
                          height="14"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M3 8.689c0-.864.933-1.406 1.683-.977l7.108 4.061a1.125 1.125 0 010 1.954l-7.108 4.061A1.125 1.125 0 013 16.811V8.69zM12.75 8.689c0-.864.933-1.406 1.683-.977l7.108 4.061a1.125 1.125 0 010 1.954l-7.108 4.061a1.125 1.125 0 01-1.683-.977V8.69z"
                          />
                        </svg>
                      </div>
                      <span style={{ fontWeight: 600 }}>{wf.name}</span>
                    </div>
                  </td>
                  <td>
                    <span className="badge badge-primary">
                      {wf.entityTypeId}
                    </span>
                  </td>
                  <td>
                    <span className="state-pill">{wf.initialState}</span>
                  </td>
                  <td style={{ color: "var(--text-muted)", fontSize: "13px" }}>
                    {new Date(wf.createdAt).toLocaleDateString()}
                  </td>
                  <td>
                    <button
                      className="btn-icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/workflows/${wf.id}`);
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
