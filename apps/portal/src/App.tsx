import React, { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import type { User } from "oidc-client-ts";
import { userManager } from "./auth.js";
import { EntityTypeProvider } from "./entity-type-context.js";
import { Login } from "./pages/login.js";
import { AuthCallback } from "./pages/callback.js";
import { Layout } from "./components/layout.js";
import { Dashboard } from "./pages/dashboard.js";
import { Settings } from "./pages/settings.js";
import { RecordList } from "./pages/records/list.js";
import { RecordCreate } from "./pages/records/create.js";
import { RecordDetail } from "./pages/records/detail.js";

function RequireAuth({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    void userManager.getUser().then(setUser);
    const handler = (): void => {
      void userManager.getUser().then(setUser);
    };
    userManager.events.addUserLoaded(handler);
    userManager.events.addUserUnloaded(handler);
    return () => {
      userManager.events.removeUserLoaded(handler);
      userManager.events.removeUserUnloaded(handler);
    };
  }, []);

  if (user === undefined) {
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

  if (!user || user.expired) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export function App(): React.ReactElement {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <EntityTypeProvider>
              <Layout>
                <Routes>
                  <Route index element={<Dashboard />} />
                  <Route path="settings" element={<Settings />} />
                  <Route path=":typeSlug" element={<RecordList />} />
                  <Route path=":typeSlug/new" element={<RecordCreate />} />
                  <Route path=":typeSlug/:id" element={<RecordDetail />} />
                </Routes>
              </Layout>
            </EntityTypeProvider>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
