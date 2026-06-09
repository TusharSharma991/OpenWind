import React, { useEffect, useState } from "react";
import { useGetIdentity } from "@refinedev/core";
import { useNavigate } from "react-router-dom";
import { fetchWithAuth, API_URL } from "../lib/api.js";
import { userManager } from "../authProvider.js";

type Workflow = {
  id: string;
  name: string;
  entityTypeId: string;
  states: {
    name: string;
    label: string;
    color: string | null;
    isTerminal: boolean;
  }[];
};

type WorkflowStat = {
  workflow: Workflow;
  total: number;
  open: number;
};

const CARD_GRADIENTS = [
  "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
  "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
  "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
  "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)",
  "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",
  "linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)",
  "linear-gradient(135deg, #fccb90 0%, #d57eeb 100%)",
];

export function Dashboard(): React.ReactElement {
  const navigate = useNavigate();
  const { data: identity } = useGetIdentity<{
    id: string;
    name: string;
    email: string;
  }>();

  const [stats, setStats] = useState<WorkflowStat[]>([]);
  const [installedCount, setInstalledCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<string[]>([]);

  useEffect(() => {
    void userManager.getUser().then((u) => {
      const profile = u?.profile as Record<string, unknown> | undefined;
      const rolesMap = (profile?.["urn:zitadel:iam:org:project:roles"] ??
        {}) as Record<string, unknown>;
      setRoles(Object.keys(rolesMap));
    });
  }, []);

  useEffect(() => {
    Promise.all([
      fetchWithAuth(`${API_URL}/workflows`),
      fetchWithAuth(`${API_URL}/modules`),
    ])
      .then(async ([wfRes, modRes]) => {
        const workflows = (wfRes as { data?: Workflow[] }).data ?? [];
        const mods = (modRes as { data?: { installed: boolean }[] }).data ?? [];
        setInstalledCount(mods.filter((m) => m.installed).length);

        const wfStats = await Promise.all(
          workflows.map(async (wf) => {
            try {
              const recRes = await fetchWithAuth(
                `${API_URL}/entities?entityTypeId=${wf.entityTypeId}`,
              );
              const records =
                (recRes as { data?: { currentState: string | null }[] }).data ??
                [];
              const terminalNames = new Set(
                wf.states.filter((s) => s.isTerminal).map((s) => s.name),
              );
              const open = records.filter(
                (r) => !terminalNames.has(r.currentState ?? ""),
              ).length;
              return { workflow: wf, total: records.length, open };
            } catch {
              return { workflow: wf, total: 0, open: 0 };
            }
          }),
        );
        setStats(wfStats);
      })
      .catch(() => {
        setStats([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const totalRecords = stats.reduce((sum, s) => sum + s.total, 0);
  const totalOpen = stats.reduce((sum, s) => sum + s.open, 0);
  const name = identity?.name ?? "Admin";

  return (
    <div>
      {/* Welcome */}
      <div style={{ marginBottom: "28px" }}>
        <h2 className="page-title">
          Welcome back, {name.split(" ")[0] ?? name} 👋
        </h2>
        <p className="page-subtitle">
          Here's an overview of your workflows and records.
        </p>
      </div>

      {/* Top stat strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: "16px",
          marginBottom: "32px",
        }}
      >
        <StatCard
          label="Workflows"
          value={loading ? "…" : String(stats.length)}
          icon="⟳"
          gradient="linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
          onClick={() => navigate("/workflows")}
        />
        <StatCard
          label="Total Records"
          value={loading ? "…" : String(totalRecords)}
          icon="📋"
          gradient="linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)"
          onClick={() => navigate("/records")}
        />
        <StatCard
          label="Open / Active"
          value={loading ? "…" : String(totalOpen)}
          icon="🔄"
          gradient="linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)"
          onClick={() => navigate("/records")}
        />
        <StatCard
          label="Templates"
          value={loading ? "…" : String(installedCount)}
          icon="🧩"
          gradient="linear-gradient(135deg, #fa709a 0%, #fee140 100%)"
          onClick={() => navigate("/modules")}
        />
      </div>

      {/* Workflow breakdown */}
      <div className="data-panel" style={{ marginBottom: "24px" }}>
        <div className="panel-header">
          <h3 className="panel-title">Workflows at a Glance</h3>
          <button
            className="btn-primary btn-sm"
            onClick={() => navigate("/workflows/new")}
          >
            + New Workflow
          </button>
        </div>

        {loading ? (
          <div style={{ padding: "32px", textAlign: "center" }}>
            <div className="spinner" style={{ margin: "0 auto" }} />
          </div>
        ) : stats.length === 0 ? (
          <div className="empty-state" style={{ padding: "40px" }}>
            <div className="empty-icon">⟳</div>
            <h4>No workflows yet</h4>
            <p>Create your first workflow to start tracking records.</p>
            <button
              className="btn-primary"
              style={{ marginTop: "12px" }}
              onClick={() => navigate("/workflows/new")}
            >
              + New Workflow
            </button>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: "16px",
              padding: "4px",
            }}
          >
            {stats.map((s, i) => {
              const gradient =
                CARD_GRADIENTS[i % CARD_GRADIENTS.length] ?? CARD_GRADIENTS[0];
              const activeStates = s.workflow.states.filter(
                (st) => !st.isTerminal,
              );
              const pct =
                s.total > 0 ? Math.round((s.open / s.total) * 100) : 0;

              return (
                <div
                  key={s.workflow.id}
                  onClick={() => navigate(`/records/${s.workflow.id}`)}
                  style={{
                    borderRadius: "14px",
                    overflow: "hidden",
                    cursor: "pointer",
                    border: "1px solid var(--border-color)",
                    background: "var(--bg-secondary)",
                    transition: "transform .15s, box-shadow .15s",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLDivElement).style.transform =
                      "translateY(-2px)";
                    (e.currentTarget as HTMLDivElement).style.boxShadow =
                      "var(--shadow-lg)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLDivElement).style.transform =
                      "translateY(0)";
                    (e.currentTarget as HTMLDivElement).style.boxShadow =
                      "none";
                  }}
                >
                  <div
                    style={{ background: gradient, padding: "18px 20px 14px" }}
                  >
                    <div
                      style={{
                        fontSize: "15px",
                        fontWeight: 700,
                        color: "#fff",
                      }}
                    >
                      {s.workflow.name}
                    </div>
                    <div
                      style={{ display: "flex", gap: "16px", marginTop: "8px" }}
                    >
                      <div style={{ textAlign: "center" }}>
                        <div
                          style={{
                            fontSize: "22px",
                            fontWeight: 800,
                            color: "#fff",
                          }}
                        >
                          {s.total}
                        </div>
                        <div
                          style={{
                            fontSize: "10px",
                            color: "rgba(255,255,255,.7)",
                            textTransform: "uppercase",
                          }}
                        >
                          Total
                        </div>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div
                          style={{
                            fontSize: "22px",
                            fontWeight: 800,
                            color: "#fff",
                          }}
                        >
                          {s.open}
                        </div>
                        <div
                          style={{
                            fontSize: "10px",
                            color: "rgba(255,255,255,.7)",
                            textTransform: "uppercase",
                          }}
                        >
                          Open
                        </div>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div
                          style={{
                            fontSize: "22px",
                            fontWeight: 800,
                            color: "#fff",
                          }}
                        >
                          {pct}%
                        </div>
                        <div
                          style={{
                            fontSize: "10px",
                            color: "rgba(255,255,255,.7)",
                            textTransform: "uppercase",
                          }}
                        >
                          Active
                        </div>
                      </div>
                    </div>
                  </div>
                  <div style={{ padding: "12px 16px 14px" }}>
                    <div
                      style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}
                    >
                      {activeStates.slice(0, 5).map((st) => (
                        <span
                          key={st.name}
                          style={{
                            padding: "2px 6px",
                            borderRadius: "4px",
                            fontSize: "10px",
                            fontWeight: 600,
                            background: st.color
                              ? `${st.color}22`
                              : "var(--bg-tertiary)",
                            color: st.color ?? "var(--text-muted)",
                          }}
                        >
                          {st.label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Roles */}
      {roles.length > 0 && (
        <div className="data-panel">
          <div className="panel-header">
            <h3 className="panel-title">Your Roles</h3>
          </div>
          <div style={{ display: "flex", gap: "8px", padding: "4px" }}>
            {roles.map((r) => (
              <span
                key={r}
                className="badge badge-primary"
                style={{ fontSize: "12px", padding: "5px 12px" }}
              >
                {r}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  gradient,
  onClick,
}: {
  label: string;
  value: string;
  icon: string;
  gradient: string;
  onClick: () => void;
}): React.ReactElement {
  return (
    <div
      onClick={onClick}
      style={{
        borderRadius: "14px",
        background: gradient,
        padding: "20px",
        cursor: "pointer",
        transition: "transform .15s, box-shadow .15s",
        boxShadow: "0 4px 15px rgba(0,0,0,.15)",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.transform =
          "translateY(-2px)";
        (e.currentTarget as HTMLDivElement).style.boxShadow =
          "0 8px 25px rgba(0,0,0,.2)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
        (e.currentTarget as HTMLDivElement).style.boxShadow =
          "0 4px 15px rgba(0,0,0,.15)";
      }}
    >
      <div style={{ fontSize: "28px", marginBottom: "8px" }}>{icon}</div>
      <div
        style={{
          fontSize: "28px",
          fontWeight: 800,
          color: "#fff",
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: "13px",
          color: "rgba(255,255,255,.8)",
          marginTop: "4px",
          fontWeight: 500,
        }}
      >
        {label}
      </div>
    </div>
  );
}
