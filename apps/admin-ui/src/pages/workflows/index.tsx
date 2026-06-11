import React from "react";
import { useList } from "@refinedev/core";
import { useNavigate } from "react-router-dom";

type WorkflowState = {
  name: string;
  label: string;
  color: string | null;
  isTerminal: boolean;
};

type Workflow = {
  id: string;
  name: string;
  entityTypeId: string;
  initialState: string;
  createdAt: string;
  recordCount?: number;
  states?: WorkflowState[];
  transitions?: { id: string }[];
};

const CARD_ACCENTS = [
  "#6366f1",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#06b6d4",
];

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
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <div className="stat-pill">{workflows.length} workflows</div>
          <button
            className="btn-primary"
            onClick={() => navigate("/workflows/new")}
          >
            + New Workflow
          </button>
        </div>
      </div>

      {workflows.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">⟳</div>
          <h4>No workflows defined</h4>
          <p>Install a module or create a workflow for an entity type.</p>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: "20px",
          }}
        >
          {workflows.map((wf, i) => {
            const accent = CARD_ACCENTS[i % CARD_ACCENTS.length] ?? "#6366f1";
            const states = wf.states ?? [];
            const transitions = wf.transitions ?? [];
            const activeStates = states.filter((s) => !s.isTerminal);
            const terminalStates = states.filter((s) => s.isTerminal);
            const recordCount = wf.recordCount ?? 0;

            return (
              <div
                key={wf.id}
                onClick={() => navigate(`/workflows/${wf.id}`)}
                style={{
                  borderRadius: "16px",
                  overflow: "hidden",
                  cursor: "pointer",
                  border: "1px solid var(--border-color)",
                  background: "var(--bg-secondary)",
                  transition: "transform .15s, box-shadow .15s",
                  boxShadow: "var(--shadow-sm)",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.transform =
                    "translateY(-3px)";
                  (e.currentTarget as HTMLDivElement).style.boxShadow =
                    "var(--shadow-lg)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.transform =
                    "translateY(0)";
                  (e.currentTarget as HTMLDivElement).style.boxShadow =
                    "var(--shadow-sm)";
                }}
              >
                {/* Accent bar + header */}
                <div
                  style={{
                    background: `linear-gradient(135deg, ${accent}dd 0%, ${accent}88 100%)`,
                    padding: "20px 20px 16px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: "12px",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: "17px",
                          fontWeight: 700,
                          color: "#fff",
                          lineHeight: 1.3,
                          marginBottom: "4px",
                        }}
                      >
                        {wf.name}
                      </div>
                      <div
                        style={{
                          fontSize: "11px",
                          color: "rgba(255,255,255,.7)",
                        }}
                      >
                        {states.length} states · {transitions.length}{" "}
                        transitions
                      </div>
                    </div>
                    {recordCount > 0 && (
                      <div
                        style={{
                          background: "rgba(255,255,255,.2)",
                          color: "#fff",
                          fontSize: "11px",
                          fontWeight: 600,
                          padding: "3px 8px",
                          borderRadius: "20px",
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                        }}
                      >
                        {recordCount} records
                      </div>
                    )}
                  </div>
                </div>

                {/* Body */}
                <div style={{ padding: "16px 20px 18px" }}>
                  {/* State pills */}
                  {states.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        gap: "5px",
                        flexWrap: "wrap",
                        marginBottom: "14px",
                      }}
                    >
                      {activeStates.slice(0, 4).map((s) => (
                        <span
                          key={s.name}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            padding: "2px 8px",
                            borderRadius: "20px",
                            fontSize: "11px",
                            fontWeight: 500,
                            background: s.color
                              ? `${s.color}22`
                              : "var(--bg-tertiary)",
                            color: s.color ?? "var(--text-muted)",
                            border: `1px solid ${s.color ? `${s.color}44` : "var(--border-color)"}`,
                          }}
                        >
                          <span
                            style={{
                              width: "5px",
                              height: "5px",
                              borderRadius: "50%",
                              background: s.color ?? "var(--text-muted)",
                              flexShrink: 0,
                            }}
                          />
                          {s.label}
                        </span>
                      ))}
                      {activeStates.length > 4 && (
                        <span
                          style={{
                            padding: "2px 8px",
                            borderRadius: "20px",
                            fontSize: "11px",
                            color: "var(--text-muted)",
                            background: "var(--bg-tertiary)",
                            border: "1px solid var(--border-color)",
                          }}
                        >
                          +{activeStates.length - 4} more
                        </span>
                      )}
                      {terminalStates.length > 0 && (
                        <span
                          style={{
                            padding: "2px 8px",
                            borderRadius: "20px",
                            fontSize: "11px",
                            color: "var(--text-muted)",
                            background: "var(--bg-tertiary)",
                            border: "1px solid var(--border-color)",
                          }}
                        >
                          ⬡ {terminalStates[0]?.label}
                          {terminalStates.length > 1
                            ? ` +${terminalStates.length - 1}`
                            : ""}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Footer row */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div
                      style={{ fontSize: "11px", color: "var(--text-muted)" }}
                    >
                      Initial:{" "}
                      <span className="state-pill" style={{ fontSize: "10px" }}>
                        {wf.initialState}
                      </span>
                    </div>
                    <div
                      style={{ fontSize: "11px", color: "var(--text-muted)" }}
                    >
                      {new Date(wf.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
