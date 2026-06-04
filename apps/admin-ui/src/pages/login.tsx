import React from "react";
import { userManager } from "../authProvider.js";

export function Login(): React.ReactElement {
  const [loading, setLoading] = React.useState(false);

  async function handleLogin(): Promise<void> {
    setLoading(true);
    // Clear any stale session so Zitadel always shows its login UI
    await userManager.removeUser();
    // prompt:login forces Zitadel to show its login screen even if it has an active session
    await userManager.signinRedirect({ prompt: "login" });
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-logo">W</div>
        <h1 className="login-title">OpenWind Admin</h1>
        <p className="login-subtitle">
          Access the administrative control center. Manage modules, configure
          workflows, and oversee tenant customizations.
        </p>
        <button
          className="login-btn"
          onClick={() => void handleLogin()}
          disabled={loading}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="2.5"
            stroke="currentColor"
            style={{ width: "20px", height: "20px" }}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"
            />
          </svg>
          {loading ? "Redirecting…" : "Sign in with Zitadel"}
        </button>
        <div className="login-footer">
          Secure Single Sign-On powered by Zitadel
        </div>
      </div>
    </div>
  );
}
