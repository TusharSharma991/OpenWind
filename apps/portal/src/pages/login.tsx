import React from "react";
import { userManager } from "../auth.js";

export function Login(): React.ReactElement {
  function handleLogin(): void {
    // prompt: "login" forces Zitadel to show the login form even when an
    // SSO session exists — prevents auto-login as the wrong account.
    void userManager.signinRedirect({ prompt: "login" });
  }

  return (
    <div className="login-bg">
      <div className="login-card">
        <div className="login-logo">
          <div className="logo-square">OW</div>
        </div>
        <h1 className="login-title">OpenWind</h1>
        <p className="login-subtitle">Sign in to access your workspace</p>
        <button className="login-btn" onClick={handleLogin}>
          Continue with SSO
        </button>
        <p className="login-footer">
          Contact your administrator if you don&apos;t have access.
        </p>
      </div>
    </div>
  );
}
