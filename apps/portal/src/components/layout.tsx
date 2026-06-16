import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { User } from "oidc-client-ts";
import { userManager } from "../auth.js";
import { useEntityTypes, toTypeSlug } from "../entity-type-context.js";

export function Layout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const location = useLocation();
  const [user, setUser] = useState<User | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const { entityTypes, modules } = useEntityTypes();

  useEffect(() => {
    void userManager.getUser().then(setUser);
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (
        profileRef.current &&
        !profileRef.current.contains(e.target as Node)
      ) {
        setProfileOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleLogout(): void {
    void userManager.removeUser().then(() => {
      window.location.href = "/login";
    });
  }

  const profile = user?.profile;
  const name =
    profile?.name ?? profile?.preferred_username ?? profile?.email ?? "User";
  const initials =
    name
      .split(" ")
      .slice(0, 2)
      .map((w: string) => w[0])
      .join("")
      .toUpperCase() || "U";

  const installedById = new Map(
    modules.filter((m) => m.installed).map((m) => [m.id, m]),
  );
  const installedModules = modules.filter((m) => m.installed);

  const visibleTypes = entityTypes.filter(
    (et) => !et.moduleId || installedById.has(et.moduleId),
  );

  const byModule = visibleTypes.reduce<Record<string, typeof entityTypes>>(
    (acc, et) => {
      const key = et.moduleId ?? "__custom__";
      (acc[key] ??= []).push(et);
      return acc;
    },
    {},
  );

  const moduleNames = new Map(installedModules.map((m) => [m.id, m.name]));

  return (
    <div className="app-shell">
      {/* ── Top navbar ─────────────────────────────────────────────────── */}
      <header className="topnav">
        <div className="topnav-left">
          {/* Hamburger */}
          <button
            className="hamburger-btn"
            onClick={() => setSidebarOpen((o) => !o)}
            aria-label="Toggle sidebar"
          >
            <span />
            <span />
            <span />
          </button>

          {/* Logo — always visible in topnav */}
          <Link to="/" className="topnav-brand">
            <div className="ow-badge">OW</div>
            <span className="topnav-name">OpenWind</span>
          </Link>
        </div>

        <div className="topnav-right">
          <div className="user-menu-wrap" ref={profileRef}>
            <button
              className="user-avatar-btn"
              onClick={() => setProfileOpen((o) => !o)}
              aria-label="Open profile menu"
            >
              <div className="user-avatar">{initials}</div>
            </button>

            {profileOpen && (
              <div className="profile-popup">
                <div className="profile-popup-header">
                  <div className="profile-popup-avatar">{initials}</div>
                  <div className="profile-popup-info">
                    <span className="profile-popup-name">{name}</span>
                    <span className="profile-popup-email">
                      {profile?.email ?? ""}
                    </span>
                    <span className="profile-popup-role">Customer</span>
                  </div>
                </div>
                <div className="profile-popup-divider" />
                <button className="profile-popup-logout" onClick={handleLogout}>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth="2"
                    stroke="currentColor"
                    width="16"
                    height="16"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75"
                    />
                  </svg>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="app-body">
        {/* ── Sidebar ──────────────────────────────────────────────────── */}
        <aside
          className={`sidebar ${sidebarOpen ? "sidebar-open" : "sidebar-collapsed"}`}
        >
          <nav className="sidebar-nav">
            <Link
              to="/"
              className={`nav-item ${location.pathname === "/" ? "active" : ""}`}
              title={sidebarOpen ? undefined : "Home"}
            >
              <span className="nav-icon">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  width="16"
                  height="16"
                >
                  <path
                    fillRule="evenodd"
                    d="M9.293 2.293a1 1 0 0 1 1.414 0l7 7A1 1 0 0 1 17 11h-1v6a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6H3a1 1 0 0 1-.707-1.707l7-7Z"
                    clipRule="evenodd"
                  />
                </svg>
              </span>
              {sidebarOpen && <span className="nav-label">Home</span>}
            </Link>

            {Object.entries(byModule).length === 0 && sidebarOpen && (
              <p className="sidebar-empty-hint">No modules installed.</p>
            )}

            {Object.entries(byModule).map(([mod, types]) => (
              <div key={mod} className="nav-group">
                {sidebarOpen && (
                  <div className="nav-group-label">
                    {mod === "__custom__"
                      ? "Custom"
                      : (moduleNames.get(mod) ?? mod)}
                  </div>
                )}
                {types.map((et) => {
                  const slug = toTypeSlug(et.plural || et.name);
                  const active = location.pathname.startsWith(`/${slug}`);
                  const initial = (et.plural || et.name)
                    .slice(0, 1)
                    .toUpperCase();
                  return (
                    <Link
                      key={et.id}
                      to={`/${slug}`}
                      className={`nav-item ${sidebarOpen ? "nav-item-child" : "nav-item-icon-only"} ${active ? "active" : ""}`}
                      title={sidebarOpen ? undefined : et.plural || et.name}
                    >
                      <span className="nav-icon nav-icon-letter">
                        {initial}
                      </span>
                      {sidebarOpen && (
                        <span className="nav-label">
                          {et.plural || et.name}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            ))}

            {/* Divider + Settings */}
            <div className="nav-divider" />
            <Link
              to="/settings"
              className={`nav-item ${!sidebarOpen ? "nav-item-icon-only" : ""} ${location.pathname === "/settings" ? "active" : ""}`}
              title={!sidebarOpen ? "Settings" : undefined}
            >
              <span className="nav-icon">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth="2"
                  stroke="currentColor"
                  width="18"
                  height="18"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.43l-1.003.828c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.43l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.991l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.645-.869l.214-1.28z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </span>
              {sidebarOpen && <span className="nav-label">Settings</span>}
            </Link>
          </nav>
        </aside>

        {/* ── Main content ─────────────────────────────────────────────── */}
        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}
