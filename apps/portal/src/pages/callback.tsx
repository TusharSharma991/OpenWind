import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { userManager } from "../auth.js";

export function AuthCallback(): React.ReactElement {
  const navigate = useNavigate();

  useEffect(() => {
    userManager
      .signinRedirectCallback()
      .then(() => navigate("/", { replace: true }))
      .catch((err: unknown) => {
        console.error("Auth callback failed:", err);
        navigate("/login", { replace: true });
      });
  }, []);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
      }}
    >
      <div className="spinner" />
    </div>
  );
}
