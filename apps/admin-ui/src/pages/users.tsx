import React, { useEffect, useState } from "react";
import { fetchWithAuth, API_URL } from "../lib/api.js";

interface User {
  userId: string;
  displayName: string;
  email: string;
  loginName: string;
}

function initials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((p) => p.charAt(0))
    .join("")
    .toUpperCase();
}

const AVATAR_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#ef4444",
  "#14b8a6",
];

function avatarColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash << 5) - hash + userId.charCodeAt(i);
    hash |= 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] ?? "#6366f1";
}

export function UsersPage(): React.ReactElement {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetchWithAuth(`${API_URL}/users`)
      .then((res) => {
        setUsers((res as { data: User[] }).data);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load users"),
      )
      .finally(() => setLoading(false));
  }, []);

  const filtered = query.trim()
    ? users.filter(
        (u) =>
          u.displayName.toLowerCase().includes(query.toLowerCase()) ||
          u.email.toLowerCase().includes(query.toLowerCase()) ||
          u.loginName.toLowerCase().includes(query.toLowerCase()),
      )
    : users;

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "24px",
        }}
      >
        <div>
          <h2 className="page-title">Users</h2>
          <p className="page-subtitle">
            All members of your organization, sorted alphabetically.
          </p>
        </div>
      </div>

      {/* Search */}
      <div
        style={{
          position: "relative",
          maxWidth: "340px",
          marginBottom: "20px",
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{
            position: "absolute",
            left: "10px",
            top: "50%",
            transform: "translateY(-50%)",
            opacity: 0.4,
            pointerEvents: "none",
          }}
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or email…"
          className="form-input"
          style={{ paddingLeft: "32px" }}
        />
      </div>

      {loading && (
        <div className="loading-center">
          <div className="spinner" />
          <span className="loader-text">Loading users…</span>
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      {!loading && !error && filtered.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">👥</div>
          <div className="empty-state-title">
            {query ? "No users match your search" : "No users found"}
          </div>
          <div className="empty-state-subtitle">
            {query
              ? "Try a different search term."
              : "Users appear here after they log in, or when AuthNexus is connected."}
          </div>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div
          className="data-panel"
          style={{ overflowX: "auto", overflowY: "hidden" }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              whiteSpace: "nowrap",
            }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["Name", "Login", "Email", "User ID"].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      padding: "10px 16px",
                      fontSize: "11px",
                      fontWeight: 600,
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      background: "var(--surface-secondary, var(--bg-subtle))",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((u, i) => {
                const color = avatarColor(u.userId);
                return (
                  <tr
                    key={u.userId}
                    style={{
                      borderBottom:
                        i < filtered.length - 1
                          ? "1px solid var(--border)"
                          : "none",
                    }}
                    onMouseEnter={(e) => {
                      (
                        e.currentTarget as HTMLTableRowElement
                      ).style.background = "var(--bg-subtle)";
                    }}
                    onMouseLeave={(e) => {
                      (
                        e.currentTarget as HTMLTableRowElement
                      ).style.background = "";
                    }}
                  >
                    <td style={{ padding: "12px 16px" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                        }}
                      >
                        <div
                          style={{
                            width: "32px",
                            height: "32px",
                            borderRadius: "50%",
                            background: color,
                            color: "#fff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "12px",
                            fontWeight: 700,
                            flexShrink: 0,
                          }}
                        >
                          {initials(u.displayName)}
                        </div>
                        <span
                          style={{
                            fontSize: "14px",
                            fontWeight: 500,
                            color: "var(--text-primary)",
                          }}
                        >
                          {u.displayName}
                        </span>
                      </div>
                    </td>
                    <td
                      style={{
                        padding: "12px 16px",
                        fontSize: "13px",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {u.loginName}
                    </td>
                    <td
                      style={{
                        padding: "12px 16px",
                        fontSize: "13px",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {u.email}
                    </td>
                    <td
                      style={{
                        padding: "12px 16px",
                        fontSize: "11px",
                        color: "var(--text-muted)",
                        fontFamily: "monospace",
                      }}
                    >
                      {u.userId}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div
            style={{
              padding: "10px 16px",
              fontSize: "12px",
              color: "var(--text-muted)",
              borderTop: "1px solid var(--border)",
            }}
          >
            {filtered.length} user{filtered.length !== 1 ? "s" : ""}
            {query ? ` matching "${query}"` : " total"}
          </div>
        </div>
      )}
    </div>
  );
}
