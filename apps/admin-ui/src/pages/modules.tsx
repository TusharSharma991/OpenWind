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

const MODULE_DEFAULT_NAMES: Record<string, string> = {
  helpdesk: "Support Ticket Lifecycle",
  crm: "Sales Pipeline",
  hrms: "Leave Approval",
  reimbursements: "Expense Approval",
  projects: "Task Lifecycle",
  invoicing: "Invoice Lifecycle",
  procurement: "Purchase Approval",
};

const PLAN_COLORS: Record<string, string> = {
  free: "var(--success)",
  basic: "var(--accent-primary)",
  pro: "hsl(275, 84%, 60%)",
  enterprise: "var(--warning)",
};

export function Modules(): React.ReactElement {
  const { data, isLoading, refetch } = useList<Module>({ resource: "modules" });
  const [actionError, setActionError] = useState<string | null>(null);

  // Fork modal state
  const [forkTarget, setForkTarget] = useState<Module | null>(null);
  const [forkName, setForkName] = useState("");
  const [forking, setForking] = useState(false);
  const [existingWorkflowNames, setExistingWorkflowNames] = useState<string[]>(
    [],
  );

  const modules = data?.data ?? [];
  const installedCount = modules.filter((m) => m.installed).length;

  function openForkModal(mod: Module): void {
    setForkTarget(mod);
    setForkName(MODULE_DEFAULT_NAMES[mod.slug] ?? mod.name);
    setActionError(null);
    // Load existing workflow names for uniqueness check
    void fetchWithAuth(`${API_URL}/workflows`).then((res) => {
      const wfs = (res as { data?: { name: string }[] }).data ?? [];
      setExistingWorkflowNames(wfs.map((w) => w.name.toLowerCase()));
    });
  }

  function closeForkModal(): void {
    setForkTarget(null);
    setForkName("");
    setExistingWorkflowNames([]);
  }

  async function handleFork(): Promise<void> {
    if (!forkTarget) return;
    const name = forkName.trim();
    if (!name) return;

    if (existingWorkflowNames.includes(name.toLowerCase())) {
      setActionError(
        `A workflow named "${name}" already exists. Choose a different name.`,
      );
      return;
    }

    setForking(true);
    setActionError(null);
    try {
      await fetchWithAuth(`${API_URL}/modules/${forkTarget.slug}/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowName: name }),
      });
      void refetch();
      closeForkModal();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Install failed");
    } finally {
      setForking(false);
    }
  }

  if (isLoading) {
    return (
      <div className="loading-center">
        <div className="spinner" />
        <span className="loader-text">Loading templates…</span>
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
          <h2 className="page-title">Templates</h2>
          <p className="page-subtitle">
            Pre-built workflow templates. Fork one to get a ready-made record
            type, fields, and workflow — customise it from there.
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
                  className="btn btn-primary-sm"
                  onClick={() => openForkModal(mod)}
                >
                  Fork / Copy
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

      {/* Fork modal */}
      {forkTarget && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeForkModal();
          }}
        >
          <div
            style={{
              background: "var(--bg-primary)",
              border: "1px solid var(--border-color)",
              borderRadius: "16px",
              padding: "28px 32px",
              width: "100%",
              maxWidth: "460px",
              boxShadow: "var(--shadow-lg)",
            }}
          >
            <div style={{ marginBottom: "20px" }}>
              <div style={{ fontSize: "28px", marginBottom: "8px" }}>
                {MODULE_EMOJI[forkTarget.slug] ?? "📋"}
              </div>
              <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>
                Fork "{forkTarget.name}"
              </h3>
              <p
                style={{
                  margin: "6px 0 0",
                  fontSize: "13px",
                  color: "var(--text-muted)",
                }}
              >
                Give this copy a name. It will become the workflow name visible
                in Records.
              </p>
            </div>

            <label
              style={{
                display: "block",
                fontSize: "13px",
                fontWeight: 600,
                marginBottom: "6px",
                color: "var(--text-primary)",
              }}
            >
              Workflow name
            </label>
            <input
              type="text"
              value={forkName}
              onChange={(e) => setForkName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleFork();
                if (e.key === "Escape") closeForkModal();
              }}
              placeholder="e.g. Customer Support Tickets"
              autoFocus
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: "8px",
                border: "1px solid var(--border-color)",
                background: "var(--bg-secondary)",
                color: "var(--text-primary)",
                fontSize: "14px",
                outline: "none",
                boxSizing: "border-box",
              }}
            />

            {existingWorkflowNames.includes(forkName.trim().toLowerCase()) &&
              forkName.trim() && (
                <p
                  style={{
                    marginTop: "8px",
                    fontSize: "12px",
                    color: "var(--danger)",
                  }}
                >
                  ⚠ A workflow with this name already exists.
                </p>
              )}

            {actionError && (
              <p
                style={{
                  marginTop: "10px",
                  fontSize: "13px",
                  color: "var(--danger)",
                }}
              >
                ⚠ {actionError}
              </p>
            )}

            <div
              style={{
                display: "flex",
                gap: "10px",
                justifyContent: "flex-end",
                marginTop: "24px",
              }}
            >
              <button
                className="btn btn-secondary"
                onClick={closeForkModal}
                disabled={forking}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary-sm"
                onClick={() => void handleFork()}
                disabled={
                  forking ||
                  !forkName.trim() ||
                  existingWorkflowNames.includes(forkName.trim().toLowerCase())
                }
                style={{ minWidth: "110px" }}
              >
                {forking ? "Installing…" : "Install Copy"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
