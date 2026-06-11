import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchWithAuth, API_URL } from "../auth.js";
import { useEntityTypes, toTypeSlug } from "../entity-type-context.js";

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

type EntityType = {
  id: string;
  name: string;
  plural: string;
  icon: string | null;
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
  const { entityTypes } = useEntityTypes();
  const etMap = new Map<string, EntityType>(entityTypes.map((e) => [e.id, e]));

  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWithAuth(`${API_URL}/workflows?activeOnly=true`)
      .then((res) => {
        setWorkflows((res as { data?: Workflow[] }).data ?? []);
      })
      .catch(() => setWorkflows([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="portal-loading">
        <div className="spinner" />
      </div>
    );
  }

  if (workflows.length === 0) {
    return (
      <div className="portal-page">
        <h1 className="portal-page-title">Home</h1>
        <div className="portal-empty">
          <p>
            No workflows available yet. Ask your administrator to set one up.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="portal-page">
      <h1 className="portal-page-title">Home</h1>
      <p className="portal-page-subtitle">
        Your workflows — click to view and manage your records.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: "20px",
          marginTop: "24px",
        }}
      >
        {workflows.map((wf, i) => {
          const et = etMap.get(wf.entityTypeId);
          const slug = et ? toTypeSlug(et.plural || et.name) : null;
          const gradient =
            CARD_GRADIENTS[i % CARD_GRADIENTS.length] ?? CARD_GRADIENTS[0];
          const activeStates = wf.states.filter((s) => !s.isTerminal);

          if (!slug) return null;

          return (
            <Link
              key={wf.id}
              to={`/${slug}`}
              style={{ textDecoration: "none", display: "block" }}
            >
              <div
                style={{
                  borderRadius: "16px",
                  overflow: "hidden",
                  border: "1px solid rgba(255,255,255,0.1)",
                  transition: "transform .15s, box-shadow .15s",
                  boxShadow: "0 4px 15px rgba(0,0,0,.1)",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.transform =
                    "translateY(-4px)";
                  (e.currentTarget as HTMLDivElement).style.boxShadow =
                    "0 12px 30px rgba(0,0,0,.18)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.transform =
                    "translateY(0)";
                  (e.currentTarget as HTMLDivElement).style.boxShadow =
                    "0 4px 15px rgba(0,0,0,.1)";
                }}
              >
                {/* Gradient header */}
                <div
                  style={{ background: gradient, padding: "28px 24px 22px" }}
                >
                  <div style={{ fontSize: "36px", marginBottom: "10px" }}>
                    {et?.icon ?? "📋"}
                  </div>
                  <div
                    style={{
                      fontSize: "20px",
                      fontWeight: 700,
                      color: "#fff",
                      lineHeight: 1.2,
                    }}
                  >
                    {et?.plural ?? wf.name}
                  </div>
                  <div
                    style={{
                      fontSize: "13px",
                      color: "rgba(255,255,255,.75)",
                      marginTop: "6px",
                    }}
                  >
                    {activeStates.length} stages
                  </div>
                </div>

                {/* Body with state chips */}
                <div
                  style={{
                    padding: "16px 20px 20px",
                    background: "var(--portal-card-bg, #fff)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      gap: "6px",
                      flexWrap: "wrap",
                      marginBottom: "16px",
                    }}
                  >
                    {activeStates.slice(0, 4).map((s) => (
                      <span
                        key={s.name}
                        style={{
                          padding: "2px 8px",
                          borderRadius: "20px",
                          fontSize: "11px",
                          fontWeight: 600,
                          background: s.color ? `${s.color}18` : "#f3f4f6",
                          color: s.color ?? "#6b7280",
                          border: `1px solid ${s.color ? `${s.color}33` : "#e5e7eb"}`,
                        }}
                      >
                        {s.label}
                      </span>
                    ))}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontSize: "13px",
                      fontWeight: 600,
                      color: "#6366f1",
                    }}
                  >
                    <span>View my records</span>
                    <span>→</span>
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
