import React, { useState } from "react";
import { useList } from "@refinedev/core";
import { fetchWithAuth, API_URL } from "../lib/api.js";

type Module = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  version: string;
  isSystem: boolean;
  minPlan: string;
  installed: boolean;
};

const MODULE_EMOJI: Record<string, string> = {
  helpdesk: "🎫",
  crm: "👥",
  hrms: "👷",
  projects: "📋",
  invoicing: "🧾",
  procurement: "🛒",
  reimbursements: "💸",
};

const PLAN_COLORS: Record<string, string> = {
  free: "var(--success)",
  basic: "var(--accent-primary)",
  pro: "hsl(275, 84%, 60%)",
  enterprise: "var(--warning)",
};

export function Modules(): React.ReactElement {
  const { data, isLoading, refetch } = useList<Module>({ resource: "modules" });
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const modules = data?.data ?? [];
  const installedCount = modules.filter((m) => m.installed).length;

  async function handleAction(
    slug: string,
    action: "install" | "uninstall",
  ): Promise<void> {
    setPending(slug);
    setActionError(null);
    try {
      await fetchWithAuth(`${API_URL}/modules/${slug}/${action}`, {
        method: "POST",
      });
      void refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setPending(null);
    }
  }

  if (isLoading) {
    return (
      <div className="loading-center">
        <div className="spinner" />
        <span className="loader-text">Loading modules…</span>
      </div>
    );
  }

  return (
    <div>
      {/* Page header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "28px",
        }}
      >
        <div>
          <h2 className="page-title">Module Registry</h2>
          <p className="page-subtitle">
            Install and manage business modules. Each module seeds entity types,
            workflows, and automation rules into your tenant.
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <div className="stat-pill">{installedCount} installed</div>
          <div className="stat-pill stat-pill-muted">
            {modules.length} total
          </div>
        </div>
      </div>

      {actionError && (
        <div className="alert alert-error" style={{ marginBottom: "20px" }}>
          ⚠ {actionError}
        </div>
      )}

      <div className="module-grid">
        {modules.map((mod) => (
          <div
            key={mod.slug}
            className={`module-card ${mod.installed ? "module-card-installed" : ""}`}
          >
            {/* Card top */}
            <div className="module-card-top">
              <div className="module-icon-box">
                {MODULE_EMOJI[mod.slug] ?? mod.slug.slice(0, 2).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    flexWrap: "wrap",
                    marginBottom: "4px",
                  }}
                >
                  <span className="module-name">{mod.name}</span>
                  {mod.isSystem && (
                    <span className="badge badge-primary">Core</span>
                  )}
                </div>
                <div
                  style={{ display: "flex", alignItems: "center", gap: "6px" }}
                >
                  <span
                    className="badge"
                    style={{
                      backgroundColor: mod.installed
                        ? "hsla(150, 75%, 45%, 0.15)"
                        : "hsla(225, 10%, 48%, 0.12)",
                      color: mod.installed
                        ? "var(--success)"
                        : "var(--text-muted)",
                      border: `1px solid ${mod.installed ? "hsla(150, 75%, 45%, 0.3)" : "hsla(225, 10%, 48%, 0.2)"}`,
                    }}
                  >
                    {mod.installed ? "● Installed" : "○ Available"}
                  </span>
                  <span
                    className="badge"
                    style={{
                      backgroundColor: "transparent",
                      color: PLAN_COLORS[mod.minPlan] ?? "var(--text-muted)",
                      border: `1px solid ${PLAN_COLORS[mod.minPlan] ?? "var(--border-color)"}33`,
                      fontSize: "10px",
                    }}
                  >
                    {mod.minPlan}
                  </span>
                </div>
              </div>
            </div>

            <p className="module-description">
              {mod.description ??
                `The ${mod.name} module provides domain-specific entity types, state machine workflows, and automation rules.`}
            </p>

            {/* Card footer */}
            <div className="module-card-footer">
              <div
                style={{ display: "flex", alignItems: "center", gap: "8px" }}
              >
                <code className="module-slug">{mod.slug}</code>
                <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                  v{mod.version}
                </span>
              </div>
              {!mod.isSystem && (
                <button
                  className={
                    mod.installed ? "btn btn-danger-sm" : "btn btn-primary-sm"
                  }
                  onClick={() =>
                    void handleAction(
                      mod.slug,
                      mod.installed ? "uninstall" : "install",
                    )
                  }
                  disabled={pending === mod.slug}
                >
                  {pending === mod.slug
                    ? mod.installed
                      ? "Uninstalling…"
                      : "Installing…"
                    : mod.installed
                      ? "Uninstall"
                      : "Install"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {modules.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">⬡</div>
          <h4>No modules registered</h4>
          <p>Run the platform seed to populate the module registry.</p>
        </div>
      )}
    </div>
  );
}
