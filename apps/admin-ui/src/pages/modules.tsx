import React, { useState, useMemo } from "react";
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

// ── static metadata ───────────────────────────────────────────────────────────

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

const MODULE_FEATURES: Record<string, string[]> = {
  helpdesk: [
    "Tickets",
    "Priority & SLA tracking",
    "Support categories",
    "Agent assignment",
  ],
  crm: [
    "Deals / Leads",
    "Sales pipeline stages",
    "Contact linkage",
    "Win / Loss tracking",
  ],
  hrms: [
    "Leave requests",
    "Manager approval flow",
    "HR review stage",
    "Employee records",
  ],
  reimbursements: [
    "Expense claims",
    "Finance approval",
    "Payment confirmation",
    "Receipt attachments",
  ],
  projects: [
    "Tasks & sprints",
    "Backlog management",
    "Review & sign-off",
    "Kanban states",
  ],
  invoicing: [
    "Invoice lifecycle",
    "Draft → Sent → Paid",
    "Client portal view",
    "Payment status",
  ],
  procurement: [
    "Purchase orders",
    "Multi-level approval",
    "Vendor tracking",
    "Delivery confirmation",
  ],
};

const MODULE_COLOR: Record<string, string> = {
  helpdesk: "hsl(211,100%,45%)",
  crm: "hsl(265,84%,60%)",
  hrms: "hsl(150,75%,40%)",
  reimbursements: "hsl(35,90%,50%)",
  projects: "hsl(185,80%,40%)",
  invoicing: "hsl(340,80%,58%)",
  procurement: "hsl(45,90%,48%)",
};

const PLAN_LABEL: Record<string, string> = {
  free: "Free",
  standard: "Standard",
  pro: "Pro",
  enterprise: "Enterprise",
};

// ── main component ────────────────────────────────────────────────────────────

type FilterTab = "all" | "installed" | "available";

export function Modules(): React.ReactElement {
  const { data, isLoading, refetch } = useList<Module>({ resource: "modules" });
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [search, setSearch] = useState("");

  // Install modal state
  const [forkTarget, setForkTarget] = useState<Module | null>(null);
  const [forkName, setForkName] = useState("");
  const [forking, setForking] = useState(false);
  const [existingWorkflowNames, setExistingWorkflowNames] = useState<string[]>(
    [],
  );

  const modules = data?.data ?? [];
  const installedCount = modules.filter((m) => m.installed).length;
  const availableCount = modules.length - installedCount;

  const filtered = useMemo(() => {
    let list = modules;
    if (filter === "installed") list = list.filter((m) => m.installed);
    if (filter === "available") list = list.filter((m) => !m.installed);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.slug.toLowerCase().includes(q) ||
          (m.description ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [modules, filter, search]);

  function openForkModal(mod: Module): void {
    setForkTarget(mod);
    setForkName(MODULE_DEFAULT_NAMES[mod.slug] ?? mod.name);
    setActionError(null);
    void fetchWithAuth(`${API_URL}/workflows`).then((res) => {
      const wfs = (res as { data?: { name: string }[] }).data ?? [];
      setExistingWorkflowNames(wfs.map((w) => w.name.toLowerCase()));
    });
  }

  function closeForkModal(): void {
    setForkTarget(null);
    setForkName("");
    setExistingWorkflowNames([]);
    setActionError(null);
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
        <span className="loader-text">Loading modules…</span>
      </div>
    );
  }

  const nameConflict =
    !!forkName.trim() &&
    existingWorkflowNames.includes(forkName.trim().toLowerCase());

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-color)",
          borderRadius: "var(--radius-md)",
          padding: "20px 24px",
          marginBottom: "20px",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "16px",
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "11px",
              fontWeight: 600,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              marginBottom: "4px",
            }}
          >
            Platform / Modules
          </div>
          <h2
            style={{
              fontSize: "20px",
              fontWeight: 700,
              fontFamily: "var(--font-heading)",
              margin: "0 0 4px",
            }}
          >
            Module Templates
          </h2>
          <p
            style={{ fontSize: "13px", color: "var(--text-muted)", margin: 0 }}
          >
            Pre-built workflow templates. Fork a module to instantly create
            entity types, fields, and a state machine workflow — then customise
            freely.
          </p>
        </div>

        {/* Summary chips */}
        <div
          style={{
            display: "flex",
            gap: "10px",
            flexShrink: 0,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              padding: "10px 18px",
              background: "hsla(150,75%,40%,.08)",
              border: "1px solid hsla(150,75%,40%,.2)",
              borderRadius: "var(--radius-sm)",
              minWidth: "70px",
            }}
          >
            <span
              style={{
                fontSize: "22px",
                fontWeight: 800,
                fontFamily: "var(--font-heading)",
                color: "hsl(150,75%,45%)",
                lineHeight: 1,
              }}
            >
              {installedCount}
            </span>
            <span
              style={{
                fontSize: "10px",
                fontWeight: 600,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginTop: "4px",
              }}
            >
              Installed
            </span>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              padding: "10px 18px",
              background: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-sm)",
              minWidth: "70px",
            }}
          >
            <span
              style={{
                fontSize: "22px",
                fontWeight: 800,
                fontFamily: "var(--font-heading)",
                color: "var(--text-primary)",
                lineHeight: 1,
              }}
            >
              {availableCount}
            </span>
            <span
              style={{
                fontSize: "10px",
                fontWeight: 600,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginTop: "4px",
              }}
            >
              Available
            </span>
          </div>
        </div>
      </div>

      {actionError && (
        <div className="alert alert-error" style={{ marginBottom: "16px" }}>
          ⚠ {actionError}
        </div>
      )}

      {/* ── Filter bar ──────────────────────────────────────────────────── */}
      <div className="mod-filter-bar">
        {/* tabs */}
        <div
          style={{
            display: "flex",
            background: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "var(--radius-sm)",
            padding: "3px",
            gap: "2px",
          }}
        >
          {(["all", "installed", "available"] as FilterTab[]).map((tab) => {
            const count =
              tab === "all"
                ? modules.length
                : tab === "installed"
                  ? installedCount
                  : availableCount;
            return (
              <button
                key={tab}
                onClick={() => setFilter(tab)}
                style={{
                  padding: "5px 14px",
                  borderRadius: "5px",
                  fontSize: "12px",
                  fontWeight: 600,
                  border: "none",
                  cursor: "pointer",
                  textTransform: "capitalize",
                  transition: "background .12s, color .12s",
                  background:
                    filter === tab ? "var(--accent-primary)" : "transparent",
                  color: filter === tab ? "#fff" : "var(--text-muted)",
                  display: "flex",
                  gap: "6px",
                  alignItems: "center",
                }}
              >
                {tab}
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    background:
                      filter === tab
                        ? "rgba(255,255,255,.2)"
                        : "var(--bg-tertiary)",
                    padding: "0px 5px",
                    borderRadius: "10px",
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* search */}
        <input
          type="text"
          className="mod-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search modules…"
        />
      </div>

      {/* ── Module grid ─────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">⬡</div>
          <h4>No modules found</h4>
          <p>
            {search
              ? `No modules match "${search}"`
              : "Run the platform seed to populate the module registry."}
          </p>
        </div>
      ) : (
        <div className="mod-grid">
          {filtered.map((mod) => {
            const accent = MODULE_COLOR[mod.slug] ?? "var(--accent-primary)";
            const features = MODULE_FEATURES[mod.slug] ?? [];
            return (
              <ModuleCard
                key={mod.slug}
                mod={mod}
                accent={accent}
                features={features}
                onInstall={openForkModal}
              />
            );
          })}
        </div>
      )}

      {/* ── Install modal ────────────────────────────────────────────────── */}
      {forkTarget && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeForkModal();
          }}
        >
          <div
            style={{
              background: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-lg)",
              width: "100%",
              maxWidth: "480px",
              boxShadow: "var(--shadow-lg)",
              overflow: "hidden",
            }}
          >
            {/* modal header */}
            <div
              style={{
                padding: "20px 24px 16px",
                borderBottom: "1px solid var(--border-color)",
                display: "flex",
                alignItems: "center",
                gap: "14px",
              }}
            >
              <div
                style={{
                  width: "46px",
                  height: "46px",
                  borderRadius: "10px",
                  background: `${MODULE_COLOR[forkTarget.slug] ?? "var(--accent-primary)"}18`,
                  border: `1px solid ${MODULE_COLOR[forkTarget.slug] ?? "var(--accent-primary)"}33`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "24px",
                  flexShrink: 0,
                }}
              >
                {MODULE_EMOJI[forkTarget.slug] ?? "📋"}
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: "16px",
                    fontWeight: 700,
                    color: "var(--text-primary)",
                  }}
                >
                  Install "{forkTarget.name}"
                </div>
                <div
                  style={{
                    fontSize: "12px",
                    color: "var(--text-muted)",
                    marginTop: "2px",
                  }}
                >
                  Creates entity type, fields, and a workflow for your tenant.
                </div>
              </div>
              <button
                onClick={closeForkModal}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  fontSize: "20px",
                  cursor: "pointer",
                  lineHeight: 1,
                  padding: "0 4px",
                  flexShrink: 0,
                }}
              >
                ×
              </button>
            </div>

            {/* modal body */}
            <div style={{ padding: "20px 24px" }}>
              {/* what gets created */}
              <div
                style={{
                  background: "var(--bg-tertiary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "var(--radius-sm)",
                  padding: "12px 14px",
                  marginBottom: "20px",
                }}
              >
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    color: "var(--text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                    marginBottom: "8px",
                  }}
                >
                  What will be created
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                  }}
                >
                  {(MODULE_FEATURES[forkTarget.slug] ?? []).map((f) => (
                    <div
                      key={f}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        fontSize: "13px",
                        color: "var(--text-secondary)",
                      }}
                    >
                      <span
                        style={{ color: "hsl(150,75%,45%)", fontSize: "12px" }}
                      >
                        ✓
                      </span>
                      {f}
                    </div>
                  ))}
                </div>
              </div>

              {/* workflow name input */}
              <div className="form-group">
                <label className="form-label">Workflow Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={forkName}
                  onChange={(e) => {
                    setForkName(e.target.value);
                    setActionError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !nameConflict && forkName.trim())
                      void handleFork();
                    if (e.key === "Escape") closeForkModal();
                  }}
                  placeholder="e.g. Customer Support Tickets"
                  autoFocus
                />
                <div className="form-hint">
                  This becomes the workflow name visible in Records.
                </div>
                {nameConflict && (
                  <div
                    style={{
                      marginTop: "6px",
                      fontSize: "12px",
                      color: "var(--danger)",
                    }}
                  >
                    ⚠ A workflow with this name already exists.
                  </div>
                )}
              </div>

              {actionError && (
                <div
                  className="alert alert-error"
                  style={{ marginTop: "12px" }}
                >
                  ⚠ {actionError}
                </div>
              )}
            </div>

            {/* modal footer */}
            <div
              style={{
                padding: "14px 24px 20px",
                borderTop: "1px solid var(--border-color)",
                display: "flex",
                justifyContent: "flex-end",
                gap: "10px",
              }}
            >
              <button
                className="btn-secondary"
                onClick={closeForkModal}
                disabled={forking}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={() => void handleFork()}
                disabled={forking || !forkName.trim() || nameConflict}
                style={{ minWidth: "120px" }}
              >
                {forking ? "Installing…" : "Install Module"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── ModuleCard ────────────────────────────────────────────────────────────────

function ModuleCard({
  mod,
  accent,
  features,
  onInstall,
}: {
  mod: Module;
  accent: string;
  features: string[];
  onInstall: (mod: Module) => void;
}): React.ReactElement {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: "var(--bg-card)",
        border: `1px solid ${hovered ? accent + "55" : "var(--border-color)"}`,
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        transition: "border-color .15s, box-shadow .15s",
        boxShadow: hovered ? `0 4px 20px ${accent}22` : "none",
        position: "relative",
      }}
    >
      {/* top accent stripe */}
      <div
        style={{
          height: "3px",
          background: mod.installed
            ? `linear-gradient(90deg, ${accent}, ${accent}99)`
            : "var(--bg-tertiary)",
          transition: "background .2s",
        }}
      />

      {/* card header */}
      <div
        style={{
          padding: "18px 20px 14px",
          display: "flex",
          alignItems: "flex-start",
          gap: "14px",
          borderBottom: "1px solid var(--border-color)",
        }}
      >
        {/* icon */}
        <div
          style={{
            width: "48px",
            height: "48px",
            borderRadius: "10px",
            background: `${accent}14`,
            border: `1px solid ${accent}30`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "24px",
            flexShrink: 0,
          }}
        >
          {MODULE_EMOJI[mod.slug] ?? mod.slug.slice(0, 2).toUpperCase()}
        </div>

        {/* name + badges */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              flexWrap: "wrap",
              marginBottom: "6px",
            }}
          >
            <span
              style={{
                fontSize: "15px",
                fontWeight: 700,
                color: "var(--text-primary)",
                fontFamily: "var(--font-heading)",
              }}
            >
              {mod.name}
            </span>
            {mod.isSystem && (
              <span
                className="badge badge-primary"
                style={{ fontSize: "10px" }}
              >
                Core
              </span>
            )}
          </div>

          {/* status + plan row */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {/* status dot + label */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "5px",
                padding: "2px 8px",
                borderRadius: "20px",
                fontSize: "11px",
                fontWeight: 600,
                background: mod.installed
                  ? "hsla(150,75%,40%,.12)"
                  : "var(--bg-tertiary)",
                color: mod.installed ? "hsl(150,75%,45%)" : "var(--text-muted)",
                border: `1px solid ${mod.installed ? "hsla(150,75%,40%,.25)" : "var(--border-color)"}`,
              }}
            >
              <div
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background: mod.installed
                    ? "hsl(150,75%,45%)"
                    : "var(--text-muted)",
                  flexShrink: 0,
                }}
              />
              {mod.installed ? "Installed" : "Available"}
            </div>

            {/* plan */}
            <span
              style={{
                padding: "2px 8px",
                borderRadius: "20px",
                fontSize: "10px",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                background: "var(--bg-tertiary)",
                color: "var(--text-muted)",
                border: "1px solid var(--border-color)",
              }}
            >
              {PLAN_LABEL[mod.minPlan] ?? mod.minPlan}
            </span>
          </div>
        </div>
      </div>

      {/* description + features */}
      <div style={{ padding: "14px 20px", flex: 1 }}>
        <p
          style={{
            fontSize: "13px",
            color: "var(--text-secondary)",
            lineHeight: "1.55",
            margin: "0 0 12px",
          }}
        >
          {mod.description ??
            `The ${mod.name} module provides domain-specific entity types, state machine workflows, and automation rules.`}
        </p>

        {features.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "4px 8px",
            }}
          >
            {features.slice(0, 4).map((f) => (
              <div
                key={f}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "12px",
                  color: "var(--text-muted)",
                }}
              >
                <div
                  style={{
                    width: "5px",
                    height: "5px",
                    borderRadius: "50%",
                    background: accent,
                    flexShrink: 0,
                  }}
                />
                {f}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* card footer */}
      <div
        style={{
          padding: "12px 20px 16px",
          borderTop: "1px solid var(--border-color)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "10px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <code
            style={{
              fontSize: "11px",
              fontFamily: "monospace",
              color: "var(--text-muted)",
              background: "var(--bg-tertiary)",
              border: "1px solid var(--border-color)",
              borderRadius: "4px",
              padding: "2px 7px",
            }}
          >
            {mod.slug}
          </code>
          <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
            v{mod.version}
          </span>
        </div>

        {!mod.isSystem &&
          (mod.installed ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "12px",
                color: "hsl(150,75%,45%)",
                fontWeight: 600,
              }}
            >
              <span>✓</span>
              Installed
            </div>
          ) : (
            <button
              className="btn-primary btn-sm"
              onClick={() => onInstall(mod)}
              style={{
                background: `linear-gradient(135deg, ${accent}, ${accent}cc)`,
                boxShadow: `0 2px 8px ${accent}33`,
              }}
            >
              + Install
            </button>
          ))}
      </div>
    </div>
  );
}
