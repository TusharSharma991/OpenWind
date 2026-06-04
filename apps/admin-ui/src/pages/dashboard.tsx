import React, { useEffect, useState } from "react";
import { useGetIdentity, useList } from "@refinedev/core";
import { userManager } from "../authProvider.js";
import type { User } from "oidc-client-ts";

type ModuleRecord = {
  id: string;
  name: string;
  slug: string;
  installed: boolean;
};

export function Dashboard(): React.ReactElement {
  const { data: identity } = useGetIdentity<{
    id: string;
    name: string;
    email: string;
  }>();
  const { data: modulesData, isLoading: modulesLoading } =
    useList<ModuleRecord>({
      resource: "modules",
    });

  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    void userManager.getUser().then((u) => {
      setUser(u);
    });
  }, []);

  const profile = user?.profile;
  const tenantId =
    typeof profile?.["urn:zitadel:iam:org:id"] === "string"
      ? profile["urn:zitadel:iam:org:id"]
      : "Loading...";
  const rolesMap = (profile?.["urn:zitadel:iam:org:project:roles"] ??
    {}) as Record<string, unknown>;
  const roles = Object.keys(rolesMap);

  return (
    <div>
      {/* Welcome Card */}
      <div className="data-panel" style={{ marginBottom: "24px" }}>
        <h2 style={{ fontSize: "24px", marginBottom: "8px" }}>
          Welcome back, {identity?.name ?? "Admin User"}!
        </h2>
        <p style={{ color: "var(--text-secondary)" }}>
          OpenWind platform is fully active. You are connected as a tenant
          administrator.
        </p>
      </div>

      {/* Stats Cards */}
      <div className="card-grid">
        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-title">Active Tenant ID</span>
            <div className="stat-icon">
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
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
            </div>
          </div>
          <div
            className="stat-value"
            style={{
              fontSize: "15px",
              fontFamily: "monospace",
              overflow: "hidden",
              textOverflow: "ellipsis",
              wordBreak: "break-all",
            }}
          >
            {tenantId}
          </div>
          <div className="stat-desc">
            Organization context loaded from Zitadel claims
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-title">User Roles</span>
            <div className="stat-icon">
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
                  d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.75h-.152c-3.196 0-6.1-1.249-8.25-3.286zm0 13.036h.008v.008H12v-.008z"
                />
              </svg>
            </div>
          </div>
          <div className="stat-value" style={{ fontSize: "20px" }}>
            {roles.length > 0 ? (
              <div
                style={{
                  display: "flex",
                  gap: "6px",
                  flexWrap: "wrap",
                  marginTop: "4px",
                }}
              >
                {roles.map((role) => (
                  <span key={role} className="badge badge-primary">
                    {role}
                  </span>
                ))}
              </div>
            ) : (
              <span className="badge badge-primary">No explicit roles</span>
            )}
          </div>
          <div className="stat-desc" style={{ marginTop: "8px" }}>
            Assigned project roles mapped to session
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-title">Installed Modules</span>
            <div className="stat-icon">
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
                  d="M6 13.5V3.75m0 9.75a1.5 1.5 0 010 3m0-3a1.5 1.5 0 000 3m0 0V21m0-4.5h12M12 10.5V3.75m0 6.75a1.5 1.5 0 010 3m0-3a1.5 1.5 0 000 3m0 0V21m0-4.5H3m12-4.5V3.75m0 6.75a1.5 1.5 0 010 3m0-3a1.5 1.5 0 000 3m0 0V21m0-4.5h-12"
                />
              </svg>
            </div>
          </div>
          <div className="stat-value">
            {modulesLoading ? "..." : (modulesData?.data.length ?? 0)}
          </div>
          <div className="stat-desc">
            Dynamic modules active in tenant registry
          </div>
        </div>
      </div>

      {/* Module Registry Verification */}
      <div className="data-panel">
        <div className="panel-header">
          <h3 className="panel-title">System Module Status</h3>
          <span className="badge badge-success">API Connected</span>
        </div>

        {modulesLoading ? (
          <p style={{ color: "var(--text-secondary)" }}>
            Querying module registry...
          </p>
        ) : modulesData?.data && modulesData.data.length > 0 ? (
          <div className="metadata-grid" style={{ gridTemplateColumns: "1fr" }}>
            {modulesData.data.map((mod) => (
              <div
                key={mod.id}
                className="metadata-item flex justify-between align-center"
                style={{ padding: "16px 20px" }}
              >
                <div>
                  <h4 style={{ fontSize: "16px", marginBottom: "4px" }}>
                    {mod.name}
                  </h4>
                  <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>
                    Slug:{" "}
                    <span style={{ fontFamily: "monospace" }}>{mod.slug}</span>
                  </p>
                </div>
                <span
                  className={`badge ${mod.installed ? "badge-success" : "badge-primary"}`}
                >
                  {mod.installed ? "Installed" : "Available"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ color: "var(--text-secondary)" }}>
            No modules registered in the system database yet.
          </p>
        )}
      </div>

      {/* Zitadel Session Metadata */}
      <div className="data-panel">
        <div className="panel-header">
          <h3 className="panel-title">Identity Provider Session Tokens</h3>
        </div>
        <p style={{ color: "var(--text-secondary)", marginBottom: "16px" }}>
          The active OIDC authorization details are printed below for system
          integration validation:
        </p>
        <div className="metadata-grid">
          <div className="metadata-item">
            <div className="metadata-label">Access Token (Truncated)</div>
            <div className="metadata-value">
              {user?.access_token
                ? `${user.access_token.substring(0, 32)}...`
                : "None"}
            </div>
          </div>
          <div className="metadata-item">
            <div className="metadata-label">ID Token (Truncated)</div>
            <div className="metadata-value">
              {user?.id_token ? `${user.id_token.substring(0, 32)}...` : "None"}
            </div>
          </div>
          <div className="metadata-item">
            <div className="metadata-label">Expires At</div>
            <div className="metadata-value">
              {user?.expires_at
                ? new Date(user.expires_at * 1000).toLocaleString()
                : "None"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
