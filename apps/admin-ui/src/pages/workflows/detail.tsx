import React from "react";
import { useOne } from "@refinedev/core";
import { useParams, Link } from "react-router-dom";

type WorkflowState = {
  id: string;
  name: string;
  label: string;
  color: string | null;
  isTerminal: boolean;
  slaHours: number | null;
  sortOrder: number;
};

type WorkflowTransition = {
  id: string;
  fromState: string;
  toState: string;
  label: string;
  allowedRoles: string[];
  requiresComment: boolean;
  requiresFields: string[];
};

type WorkflowFull = {
  id: string;
  name: string;
  entityTypeId: string;
  initialState: string;
  createdAt: string;
  states: WorkflowState[];
  transitions: WorkflowTransition[];
};

function StateDot({ color }: { color: string | null }): React.ReactElement {
  return (
    <span
      className="state-dot"
      style={{ backgroundColor: color ?? "var(--accent-primary)" }}
    />
  );
}

function StateFlowDiagram({
  states,
  transitions,
  initialState,
}: {
  states: WorkflowState[];
  transitions: WorkflowTransition[];
  initialState: string;
}): React.ReactElement {
  const sorted = [...states].sort((a, b) => a.sortOrder - b.sortOrder);

  // Build a simple directed adjacency for ordering
  const _stateMap = new Map(states.map((s) => [s.name, s]));

  return (
    <div className="state-flow">
      {sorted.map((state, i) => {
        const _outgoing = transitions.filter((t) => t.fromState === state.name);
        const isLast = i === sorted.length - 1;

        return (
          <React.Fragment key={state.id}>
            <div
              className={[
                "state-flow-node",
                state.name === initialState ? "state-flow-node--initial" : "",
                state.isTerminal ? "state-flow-node--terminal" : "",
              ].join(" ")}
              style={state.color ? { borderColor: state.color } : {}}
            >
              <StateDot color={state.color} />
              <span className="state-flow-label">{state.label}</span>
              <div className="state-flow-badges">
                {state.name === initialState && (
                  <span
                    className="badge badge-primary"
                    style={{ fontSize: "9px", padding: "2px 5px" }}
                  >
                    start
                  </span>
                )}
                {state.isTerminal && (
                  <span
                    className="badge badge-muted"
                    style={{ fontSize: "9px", padding: "2px 5px" }}
                  >
                    end
                  </span>
                )}
                {state.slaHours !== null && (
                  <span
                    className="badge badge-warning"
                    style={{ fontSize: "9px", padding: "2px 5px" }}
                  >
                    SLA {state.slaHours}h
                  </span>
                )}
              </div>
            </div>
            {!isLast && <span className="flow-arrow">→</span>}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export function WorkflowDetail(): React.ReactElement {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading } = useOne<WorkflowFull>({
    resource: "workflows",
    id: id ?? "missing",
  });

  const workflow = data?.data;

  if (isLoading) {
    return (
      <div className="loading-center">
        <div className="spinner" />
        <span className="loader-text">Loading workflow…</span>
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="empty-state">
        <h4>Workflow not found</h4>
        <Link
          to="/workflows"
          className="back-link"
          style={{ marginTop: "12px", display: "inline-block" }}
        >
          ← Back to Workflows
        </Link>
      </div>
    );
  }

  const sortedStates = [...workflow.states].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );

  return (
    <div>
      <Link to="/workflows" className="back-link">
        ← Workflows
      </Link>

      {/* Detail header */}
      <div className="detail-header">
        <div className="workflow-icon workflow-icon-lg">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="2"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 8.689c0-.864.933-1.406 1.683-.977l7.108 4.061a1.125 1.125 0 010 1.954l-7.108 4.061A1.125 1.125 0 013 16.811V8.69zM12.75 8.689c0-.864.933-1.406 1.683-.977l7.108 4.061a1.125 1.125 0 010 1.954l-7.108 4.061a1.125 1.125 0 01-1.683-.977V8.69z"
            />
          </svg>
        </div>
        <div>
          <h2 className="page-title" style={{ marginBottom: "6px" }}>
            {workflow.name}
          </h2>
          <div
            style={{
              display: "flex",
              gap: "8px",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <span className="badge badge-primary">{workflow.entityTypeId}</span>
            <span style={{ color: "var(--text-muted)", fontSize: "13px" }}>
              {workflow.states.length} states · {workflow.transitions.length}{" "}
              transitions
            </span>
            <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>
              Created {new Date(workflow.createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>
      </div>

      {/* State flow diagram */}
      <div className="data-panel" style={{ marginBottom: "24px" }}>
        <div className="panel-header">
          <h3 className="panel-title">State Flow</h3>
          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            initial → … → terminal
          </span>
        </div>
        <StateFlowDiagram
          states={workflow.states}
          transitions={workflow.transitions}
          initialState={workflow.initialState}
        />
      </div>

      {/* States table */}
      <div className="data-panel" style={{ marginBottom: "24px" }}>
        <div className="panel-header">
          <h3 className="panel-title">States</h3>
          <span className="badge badge-muted">{workflow.states.length}</span>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>State</th>
              <th>Label</th>
              <th>Type</th>
              <th>SLA</th>
            </tr>
          </thead>
          <tbody>
            {sortedStates.map((state) => (
              <tr key={state.id}>
                <td>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <StateDot color={state.color} />
                    <code className="code-inline">{state.name}</code>
                    {state.name === workflow.initialState && (
                      <span
                        className="badge badge-primary"
                        style={{ fontSize: "10px" }}
                      >
                        initial
                      </span>
                    )}
                  </div>
                </td>
                <td style={{ fontWeight: 500 }}>{state.label}</td>
                <td>
                  {state.isTerminal ? (
                    <span className="badge badge-muted">Terminal</span>
                  ) : state.name === workflow.initialState ? (
                    <span className="badge badge-primary">Initial</span>
                  ) : (
                    <span className="badge badge-success">Active</span>
                  )}
                </td>
                <td style={{ fontSize: "13px" }}>
                  {state.slaHours !== null ? (
                    <span style={{ color: "var(--warning)", fontWeight: 500 }}>
                      {state.slaHours}h
                    </span>
                  ) : (
                    <span className="text-muted-sm">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Transitions table */}
      <div className="data-panel">
        <div className="panel-header">
          <h3 className="panel-title">Transitions</h3>
          <span className="badge badge-muted">
            {workflow.transitions.length}
          </span>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>From</th>
              <th style={{ width: "28px" }}></th>
              <th>To</th>
              <th>Label</th>
              <th>Allowed Roles</th>
              <th>Requirements</th>
            </tr>
          </thead>
          <tbody>
            {workflow.transitions.map((t) => (
              <tr key={t.id}>
                <td>
                  <code className="code-inline">{t.fromState}</code>
                </td>
                <td
                  style={{
                    color: "var(--text-muted)",
                    fontWeight: 700,
                    textAlign: "center",
                  }}
                >
                  →
                </td>
                <td>
                  <code className="code-inline">{t.toState}</code>
                </td>
                <td style={{ fontWeight: 500 }}>{t.label}</td>
                <td>
                  {t.allowedRoles.length === 0 ? (
                    <span className="text-muted-sm">Any</span>
                  ) : (
                    <div
                      style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}
                    >
                      {t.allowedRoles.map((r) => (
                        <span key={r} className="badge badge-primary">
                          {r}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td>
                  {!t.requiresComment && t.requiresFields.length === 0 ? (
                    <span className="text-muted-sm">—</span>
                  ) : (
                    <div
                      style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}
                    >
                      {t.requiresComment && (
                        <span className="badge badge-warning">Comment</span>
                      )}
                      {t.requiresFields.length > 0 && (
                        <span className="badge badge-warning">
                          {t.requiresFields.length} field
                          {t.requiresFields.length > 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
