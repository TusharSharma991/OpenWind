import React from "react";
import { Refine, Authenticated } from "@refinedev/core";
import routerProvider from "@refinedev/react-router-v6";
import {
  BrowserRouter,
  Routes,
  Route,
  Outlet,
  Navigate,
} from "react-router-dom";
import { authProvider } from "./authProvider.js";
import { dataProvider } from "./dataProvider.js";
import { Login } from "./pages/login.js";
import { AuthCallback } from "./pages/callback.js";
import { Layout } from "./components/layout.js";
import { Dashboard } from "./pages/dashboard.js";
import { Modules } from "./pages/modules.js";
import { EntityTypes } from "./pages/entity-types/index.js";
import { EntityTypeDetail } from "./pages/entity-types/detail.js";
import { Workflows } from "./pages/workflows/index.js";
import { WorkflowDetail } from "./pages/workflows/detail.js";
import { Settings } from "./pages/settings.js";
import "./index.css";

export function App(): React.ReactElement {
  return (
    <BrowserRouter>
      <Refine
        authProvider={authProvider}
        dataProvider={dataProvider}
        routerProvider={routerProvider}
        resources={[
          {
            name: "dashboard",
            list: "/",
            meta: { label: "Dashboard", icon: "home" },
          },
          {
            name: "modules",
            list: "/modules",
            meta: { label: "Modules", icon: "modules" },
          },
          {
            name: "entity-types",
            list: "/entity-types",
            show: "/entity-types/:id",
            meta: { label: "Entity Types", icon: "entity-types" },
          },
          {
            name: "workflows",
            list: "/workflows",
            show: "/workflows/:id",
            meta: { label: "Workflows", icon: "workflows" },
          },
        ]}
      >
        <Routes>
          {/* Auth routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/auth/callback" element={<AuthCallback />} />

          {/* Protected routes */}
          <Route
            element={
              <Authenticated
                key="protected"
                fallback={<Navigate to="/login" />}
              >
                <Layout>
                  <Outlet />
                </Layout>
              </Authenticated>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="/modules" element={<Modules />} />
            <Route path="/entity-types" element={<EntityTypes />} />
            <Route path="/entity-types/:id" element={<EntityTypeDetail />} />
            <Route path="/workflows" element={<Workflows />} />
            <Route path="/workflows/:id" element={<WorkflowDetail />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Routes>
      </Refine>
    </BrowserRouter>
  );
}
