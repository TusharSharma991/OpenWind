import React, { useEffect, useState } from "react";
import {
  applyTheme,
  applyAccent,
  getSavedTheme,
  getSavedAccent,
  ACCENT_COLORS,
  makeCustomAccent,
  hslToHex,
  type ThemeMode,
  type AccentColor,
} from "../lib/theme.js";
import { Button } from "@platform/ui";
import { fetchWithAuth, API_URL } from "../lib/api.js";
import { userManager, getRolesFromProfile } from "../authProvider.js";
import {
  getPasswordPolicy,
  verifyCurrentPassword,
  directResetPassword,
  PasswordResetError,
  type PasswordPolicy,
} from "../lib/password-reset.js";
import { ApiKeys } from "./api-keys/index.js";

type ModuleRow = {
  slug: string;
  name: string;
  isVisible: boolean;
};

type SettingsTab =
  | "appearance"
  | "security"
  | "notifications"
  | "templates"
  | "api-keys";

function ReqChipIcon({ met }: { met: boolean }): React.ReactElement {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth="3"
      stroke="currentColor"
    >
      {met ? (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="m4.5 12.75 6 6 9-13.5"
        />
      ) : (
        <circle cx="12" cy="12" r="8.5" />
      )}
    </svg>
  );
}

export function Settings(): React.ReactElement {
  const [theme, setTheme] = useState<ThemeMode>(getSavedTheme);
  const [accent, setAccent] = useState<AccentColor>(getSavedAccent);

  const [activeTab, setActiveTab] = useState<SettingsTab>("appearance");

  const [isAdmin, setIsAdmin] = useState(false);
  const [roleLoaded, setRoleLoaded] = useState(false);
  const [templateModules, setTemplateModules] = useState<ModuleRow[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [togglingSlug, setTogglingSlug] = useState<string | null>(null);

  const [outboundEnabled, setOutboundEnabled] = useState(false);
  const [outboundLoading, setOutboundLoading] = useState(false);
  const [outboundToggling, setOutboundToggling] = useState(false);

  // ── Security tab: direct password reset (AuthNexus's unauthenticated
  // password-reset API — see .claude/skills/authnexus-pull-guard) ──────────
  const [username, setUsername] = useState("");
  const [passwordPolicy, setPasswordPolicy] = useState<PasswordPolicy | null>(
    null,
  );
  const [currentPassword, setCurrentPassword] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  useEffect(() => {
    void userManager.getUser().then((u) => {
      const profile = u?.profile as Record<string, unknown> | undefined;
      setUsername(
        (profile?.["preferred_username"] as string | undefined) ??
          (profile?.["email"] as string | undefined) ??
          "",
      );
    });
  }, []);

  useEffect(() => {
    if (activeTab !== "security" || passwordPolicy) return;
    void getPasswordPolicy()
      .then(setPasswordPolicy)
      .catch(() => setPasswordPolicy(null));
  }, [activeTab, passwordPolicy]);

  function resetSecurityForm(): void {
    setCurrentPassword("");
    setVerified(false);
    setVerifyError(null);
    setNewPassword("");
    setConfirmPassword("");
    setSubmitError(null);
  }

  async function handleVerifyPassword(): Promise<void> {
    setVerifying(true);
    setVerifyError(null);
    try {
      const valid = await verifyCurrentPassword(username, currentPassword);
      if (valid) {
        setVerified(true);
      } else {
        setVerifyError("Incorrect current password.");
      }
    } catch (err) {
      setVerifyError(
        err instanceof PasswordResetError
          ? err.message
          : "Could not verify password.",
      );
    } finally {
      setVerifying(false);
    }
  }

  const passwordsMismatch =
    confirmPassword.length > 0 && newPassword !== confirmPassword;

  async function handleUpdatePassword(): Promise<void> {
    if (passwordsMismatch || !newPassword) return;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(false);
    try {
      await directResetPassword(username, currentPassword, newPassword);
      setSubmitSuccess(true);
      resetSecurityForm();
    } catch (err) {
      setSubmitError(
        err instanceof PasswordResetError
          ? err.message
          : "Could not update password.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    void userManager.getUser().then((u) => {
      if (!u) {
        setRoleLoaded(true);
        return;
      }
      const roles = getRolesFromProfile(u.profile as Record<string, unknown>);
      setIsAdmin(roles.includes("admin"));
      setRoleLoaded(true);
    });
  }, []);

  // Fall back to Appearance if the active tab is admin-only and the user
  // turns out not to be an admin (or role hasn't loaded yet). Security is
  // available to every role, so it's exempt from this redirect.
  useEffect(() => {
    if (!isAdmin && activeTab !== "appearance" && activeTab !== "security") {
      setActiveTab("appearance");
    }
  }, [isAdmin, activeTab]);

  useEffect(() => {
    if (!roleLoaded || !isAdmin) return;
    setTemplatesLoading(true);
    void fetchWithAuth(`${API_URL}/modules?includeHidden=true`)
      .then((res) => {
        const list = (res as { data?: ModuleRow[] }).data ?? [];
        setTemplateModules(list);
      })
      .finally(() => setTemplatesLoading(false));
  }, [roleLoaded, isAdmin]);

  useEffect(() => {
    if (!roleLoaded || !isAdmin) return;
    setOutboundLoading(true);
    void fetchWithAuth(`${API_URL}/admin/platform-settings`)
      .then((res) => {
        const data = (
          res as { data?: { outboundNotificationsEnabled?: boolean } }
        ).data;
        setOutboundEnabled(data?.outboundNotificationsEnabled ?? false);
      })
      .finally(() => setOutboundLoading(false));
  }, [roleLoaded, isAdmin]);

  async function toggleOutboundNotifications(next: boolean): Promise<void> {
    setOutboundToggling(true);
    // Optimistic update — reverted if the request fails.
    setOutboundEnabled(next);
    try {
      await fetchWithAuth(`${API_URL}/admin/platform-settings`, {
        method: "PATCH",
        body: JSON.stringify({ outboundNotificationsEnabled: next }),
      });
    } catch {
      setOutboundEnabled(!next);
    } finally {
      setOutboundToggling(false);
    }
  }

  async function toggleVisibility(slug: string, next: boolean): Promise<void> {
    setTogglingSlug(slug);
    // Optimistic update — reverted if the request fails.
    setTemplateModules((list) =>
      list.map((m) => (m.slug === slug ? { ...m, isVisible: next } : m)),
    );
    try {
      await fetchWithAuth(`${API_URL}/modules/${slug}/visibility`, {
        method: "PATCH",
        body: JSON.stringify({ isVisible: next }),
      });
    } catch {
      setTemplateModules((list) =>
        list.map((m) => (m.slug === slug ? { ...m, isVisible: !next } : m)),
      );
    } finally {
      setTogglingSlug(null);
    }
  }

  function handleTheme(mode: ThemeMode): void {
    setTheme(mode);
    applyTheme(mode);
  }

  function handleAccent(color: AccentColor): void {
    setAccent(color);
    applyAccent(color);
  }

  function handleCustomAccent(hex: string): void {
    const custom = makeCustomAccent(hex);
    setAccent(custom);
    applyAccent(custom);
  }

  const tabs: Array<{
    id: SettingsTab;
    label: string;
    icon: React.ReactNode;
  }> = [
    {
      id: "appearance",
      label: "Appearance",
      icon: (
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
            d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
          />
        </svg>
      ),
    },
    {
      id: "security",
      label: "Security",
      icon: (
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
            d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
          />
        </svg>
      ),
    },
    ...(isAdmin
      ? [
          {
            id: "notifications" as const,
            label: "Notifications",
            icon: (
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
                  d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
                />
              </svg>
            ),
          },
          {
            id: "templates" as const,
            label: "Templates",
            icon: (
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
                  d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z"
                />
              </svg>
            ),
          },
          {
            // ADR-012 Phase A (PR A5): backend routes are requireRole("admin"),
            // same ceiling as Templates above — moved here from a standalone
            // sidebar entry per the same isAdmin-gated tab pattern.
            id: "api-keys" as const,
            label: "API Keys",
            icon: (
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
                  d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"
                />
              </svg>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="settings-page" style={{ animation: "fadeIn 0.3s ease" }}>
      <section className="data-panel settings-section">
        <div className="settings-tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`settings-tab ${activeTab === tab.id ? "settings-tab-active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="settings-tab-icon">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "appearance" && (
          <div className="settings-section-body">
            {/* Theme toggle */}
            <div className="settings-field">
              <div className="settings-field-label">
                <span>Color mode</span>
                <span className="settings-field-hint">
                  Switch between dark and light interface
                </span>
              </div>
              <div className="theme-toggle-group">
                <button
                  className={`theme-option ${theme === "dark" ? "active" : ""}`}
                  onClick={() => handleTheme("dark")}
                  aria-pressed={theme === "dark"}
                >
                  <span className="theme-option-icon">
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
                        d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z"
                      />
                    </svg>
                  </span>
                  Dark
                </button>
                <button
                  className={`theme-option ${theme === "light" ? "active" : ""}`}
                  onClick={() => handleTheme("light")}
                  aria-pressed={theme === "light"}
                >
                  <span className="theme-option-icon">
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
                        d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
                      />
                    </svg>
                  </span>
                  Light
                </button>
              </div>
            </div>

            {/* Accent color */}
            <div className="settings-field">
              <div className="settings-field-label">
                <span>Accent color</span>
                <span className="settings-field-hint">
                  Sets the primary highlight color across the UI
                </span>
              </div>
              <div className="color-palette">
                {ACCENT_COLORS.map((color) => (
                  <button
                    key={color.id}
                    className={`color-swatch ${accent.id === color.id ? "selected" : ""}`}
                    title={color.label}
                    aria-label={color.label}
                    aria-pressed={accent.id === color.id}
                    onClick={() => handleAccent(color)}
                    style={
                      {
                        "--swatch-color": `hsl(${color.h}, ${color.s}%, ${color.l}%)`,
                      } as React.CSSProperties
                    }
                  />
                ))}
                <label
                  className={`color-swatch color-swatch-custom ${accent.id === "custom" ? "selected" : ""}`}
                  title="Custom color"
                  aria-label="Custom color"
                  style={
                    {
                      "--swatch-color": `hsl(${accent.h}, ${accent.s}%, ${accent.l}%)`,
                      background:
                        accent.id === "custom"
                          ? `hsl(${accent.h}, ${accent.s}%, ${accent.l}%)`
                          : undefined,
                    } as React.CSSProperties
                  }
                >
                  <input
                    type="color"
                    value={hslToHex(accent.h, accent.s, accent.l)}
                    onChange={(e) => handleCustomAccent(e.target.value)}
                    aria-label="Pick a custom accent color"
                  />
                </label>
              </div>
              <div className="color-preview">
                <span className="color-preview-name">{accent.label}</span>
                <span
                  className="color-preview-swatch"
                  style={{
                    background: `hsl(${accent.h}, ${accent.s}%, ${accent.l}%)`,
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Security — every role. AuthNexus's direct password-reset API:
            unauthenticated, called straight from the browser. current
            password must verify before the new-password fields appear, and
            direct-reset-password re-verifies it again server-side either way. */}
        {activeTab === "security" && (
          <div className="settings-section-body security-panel">
            <div className="security-header">
              <div className="security-header-icon">
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
                    d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
                  />
                </svg>
              </div>
              <div>
                <h3 className="security-header-title">Change password</h3>
                <p className="security-header-desc">
                  Update your AuthNexus account password directly — no email
                  round-trip, no reset link to wait on.
                </p>
              </div>
            </div>

            {/* Step 1 — identity */}
            <div className="security-step">
              <div className="security-step-head">
                <div className="security-step-head-left">
                  <span className="security-step-number">1</span>
                  <span className="security-step-title">
                    Verify your identity
                  </span>
                </div>
                {verified ? (
                  <span className="badge badge-success">Verified</span>
                ) : (
                  <span className="badge badge-muted">Not verified</span>
                )}
              </div>

              <div className="settings-field-label" style={{ marginBottom: 8 }}>
                <span>Username</span>
              </div>
              <input
                className="form-input"
                value={username}
                disabled
                readOnly
                style={{ marginBottom: 16 }}
              />

              <div className="settings-field-label" style={{ marginBottom: 8 }}>
                <span>Current password</span>
              </div>
              <div className="security-field-row">
                <input
                  type="password"
                  className="form-input"
                  value={currentPassword}
                  disabled={verified}
                  onChange={(e) => {
                    setCurrentPassword(e.target.value);
                    setVerifyError(null);
                  }}
                  placeholder="Enter current password"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !verified && currentPassword) {
                      void handleVerifyPassword();
                    }
                  }}
                />
                {!verified && (
                  <Button
                    variant="secondary"
                    disabled={verifying || !currentPassword}
                    onClick={() => void handleVerifyPassword()}
                  >
                    {verifying ? "Verifying…" : "Verify"}
                  </Button>
                )}
              </div>

              {verifyError && (
                <div className="security-note security-note-danger">
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
                      d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                    />
                  </svg>
                  {verifyError}
                </div>
              )}
              {verified && (
                <div className="security-note security-note-success">
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
                      d="m4.5 12.75 6 6 9-13.5"
                    />
                  </svg>
                  Identity verified — set a new password below.
                </div>
              )}
            </div>

            {/* Step 2 — new password */}
            <div
              className={`security-step ${!verified ? "security-step-disabled" : ""}`}
            >
              <div className="security-step-head">
                <div className="security-step-head-left">
                  <span className="security-step-number">2</span>
                  <span className="security-step-title">
                    Choose a new password
                  </span>
                </div>
              </div>

              <div className="settings-field-label" style={{ marginBottom: 8 }}>
                <span>New password</span>
              </div>
              <input
                type="password"
                className="form-input"
                style={{ marginBottom: 16 }}
                value={newPassword}
                disabled={!verified}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
              />

              <div className="settings-field-label" style={{ marginBottom: 8 }}>
                <span>Confirm new password</span>
              </div>
              <input
                type="password"
                className="form-input"
                value={confirmPassword}
                disabled={!verified}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
              />

              {passwordPolicy && (
                <div className="security-requirements">
                  <span
                    className={`security-req-chip ${
                      newPassword.length >= passwordPolicy.minLength
                        ? "security-req-chip-met"
                        : ""
                    }`}
                  >
                    <ReqChipIcon
                      met={newPassword.length >= passwordPolicy.minLength}
                    />
                    {passwordPolicy.minLength}+ characters
                  </span>
                  {passwordPolicy.requireUppercase && (
                    <span
                      className={`security-req-chip ${
                        /[A-Z]/.test(newPassword) ? "security-req-chip-met" : ""
                      }`}
                    >
                      <ReqChipIcon met={/[A-Z]/.test(newPassword)} />
                      Uppercase letter
                    </span>
                  )}
                  {passwordPolicy.requireLowercase && (
                    <span
                      className={`security-req-chip ${
                        /[a-z]/.test(newPassword) ? "security-req-chip-met" : ""
                      }`}
                    >
                      <ReqChipIcon met={/[a-z]/.test(newPassword)} />
                      Lowercase letter
                    </span>
                  )}
                  {passwordPolicy.requireNumber && (
                    <span
                      className={`security-req-chip ${
                        /[0-9]/.test(newPassword) ? "security-req-chip-met" : ""
                      }`}
                    >
                      <ReqChipIcon met={/[0-9]/.test(newPassword)} />
                      Number
                    </span>
                  )}
                  {passwordPolicy.requireSymbol && (
                    <span
                      className={`security-req-chip ${
                        /[^a-zA-Z0-9]/.test(newPassword)
                          ? "security-req-chip-met"
                          : ""
                      }`}
                    >
                      <ReqChipIcon met={/[^a-zA-Z0-9]/.test(newPassword)} />
                      Symbol
                    </span>
                  )}
                </div>
              )}

              {passwordsMismatch && (
                <div className="security-note security-note-danger">
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
                      d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                    />
                  </svg>
                  Passwords do not match.
                </div>
              )}

              <div
                style={{
                  marginTop: 20,
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                }}
              >
                <Button
                  variant="primary"
                  disabled={
                    !verified ||
                    submitting ||
                    !newPassword ||
                    !confirmPassword ||
                    passwordsMismatch
                  }
                  onClick={() => void handleUpdatePassword()}
                >
                  {submitting ? "Updating…" : "Update password"}
                </Button>
                {submitError && (
                  <span
                    className="settings-field-hint"
                    style={{ color: "var(--danger)" }}
                  >
                    {submitError}
                  </span>
                )}
              </div>

              {submitSuccess && (
                <div className="security-note security-note-success">
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
                      d="m4.5 12.75 6 6 9-13.5"
                    />
                  </svg>
                  Password updated successfully.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Notifications — admin only. Global kill switch for the outbound
            email/SMS/WhatsApp handoff
            (docs/specs/outbound-notifications-kill-switch.md). Not
            per-tenant: the failure mode this exists for (the external
            delivery service itself being down/misbehaving) affects every
            tenant identically. In-app notifications are unaffected either
            way. */}
        {activeTab === "notifications" && isAdmin && (
          <div className="settings-section-body">
            {outboundLoading ? (
              <div className="settings-field">
                <span className="settings-field-hint">
                  Loading notification settings…
                </span>
              </div>
            ) : (
              <div
                className="settings-field"
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "16px",
                }}
              >
                <div className="settings-field-label">
                  <span>Outbound notifications</span>
                  <span className="settings-field-hint">
                    {outboundEnabled
                      ? "Email/SMS/WhatsApp handoff is active — turn off if the outbound service is misbehaving"
                      : "Outbound handoff is disabled — in-app notifications keep working normally"}
                  </span>
                </div>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={outboundEnabled}
                    disabled={outboundToggling}
                    onChange={(e) =>
                      void toggleOutboundNotifications(e.target.checked)
                    }
                  />
                  <span className="settings-toggle-track" />
                </label>
              </div>
            )}
          </div>
        )}

        {/* Templates — admin only. Global, platform-wide toggle for which
            templates appear in every tenant's Templates page. */}
        {activeTab === "templates" && isAdmin && (
          <div className="settings-section-body">
            {templatesLoading ? (
              <div className="settings-field">
                <span className="settings-field-hint">Loading templates…</span>
              </div>
            ) : (
              templateModules.map((m) => (
                <div
                  className="settings-field"
                  key={m.slug}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "16px",
                  }}
                >
                  <div className="settings-field-label">
                    <span>{m.name}</span>
                    <span className="settings-field-hint">
                      {m.isVisible
                        ? "Visible on the Templates page for everyone"
                        : "Hidden — no tenant can see or install this template"}
                    </span>
                  </div>
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={m.isVisible}
                      disabled={togglingSlug === m.slug}
                      onChange={(e) =>
                        void toggleVisibility(m.slug, e.target.checked)
                      }
                    />
                    <span className="settings-toggle-track" />
                  </label>
                </div>
              ))
            )}
          </div>
        )}

        {/* API Keys — admin only. ADR-012 Phase A (PR A5): third-party
            application key lifecycle management, moved here from a
            standalone sidebar entry to match this page's other admin-only
            tabs (e.g. Templates above). */}
        {activeTab === "api-keys" && isAdmin && (
          <div className="settings-section-body">
            <ApiKeys />
          </div>
        )}
      </section>
    </div>
  );
}
