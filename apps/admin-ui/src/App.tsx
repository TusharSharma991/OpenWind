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
import { EntityTypeProvider } from "./entity-type-context.js";
import { Layout } from "./components/layout.js";
import { Login } from "./pages/login.js";
import { AuthCallback } from "./pages/callback.js";
import { Dashboard } from "./pages/dashboard.js";
import { Modules } from "./pages/modules.js";
import { EntityTypes } from "./pages/entity-types/index.js";
import { EntityTypeDetail } from "./pages/entity-types/detail.js";
import { EntityInstances } from "./pages/entity-types/instances.js";
import { EntityInstanceDetail } from "./pages/entity-types/instance-detail.js";
import { Workflows } from "./pages/workflows/index.js";
import { WorkflowDetail } from "./pages/workflows/detail.js";
import { CreateWorkflow } from "./pages/workflows/create.js";
import { Settings } from "./pages/settings.js";
import { CustomerDashboard } from "./pages/customer/dashboard.js";
import { CustomerRecordList } from "./pages/customer/record-list.js";
import { CustomerRecordCreate } from "./pages/customer/record-create.js";
import { CustomerRecordDetail } from "./pages/customer/record-detail.js";
import "./index.css";

export function App(): React.ReactElement {
  return (
    <BrowserRouter>
      <Refine
        authProvider={authProvider}
        dataProvider={dataProvider}
        routerProvider={routerProvider}
        resources={[
          { name: "dashboard", list: "/", meta: { label: "Dashboard" } },
          { name: "modules", list: "/modules", meta: { label: "Templates" } },
          {
            name: "entity-types",
            list: "/entity-types",
            show: "/entity-types/:id",
            meta: { label: "Entity Types" },
          },
          {
            name: "workflows",
            list: "/workflows",
            show: "/workflows/:id",
            meta: { label: "Workflows" },
          },
        ]}
      >
        <Routes>
          {/* Auth routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/auth/callback" element={<AuthCallback />} />

          {/* Protected routes — all wrapped in EntityTypeProvider for customer sidebar + pages */}
          <Route
            element={
              <Authenticated
                key="protected"
                fallback={<Navigate to="/login" />}
              >
                <EntityTypeProvider>
                  <Layout>
                    <Outlet />
                  </Layout>
                </EntityTypeProvider>
              </Authenticated>
            }
          >
            {/* Admin / Agent routes */}
            <Route index element={<Dashboard />} />
            <Route path="/modules" element={<Modules />} />
            <Route path="/entity-types" element={<EntityTypes />} />
            <Route path="/entity-types/:id" element={<EntityTypeDetail />} />
            <Route
              path="/entity-types/:id/records"
              element={<EntityInstances />}
            />
            <Route
              path="/entity-types/:id/records/:instanceId"
              element={<EntityInstanceDetail />}
            />
            <Route path="/workflows" element={<Workflows />} />
            <Route path="/workflows/new" element={<CreateWorkflow />} />
            <Route path="/workflows/:id" element={<WorkflowDetail />} />
            <Route path="/settings" element={<Settings />} />

            {/* Customer routes — prefixed with /records/ to avoid slug conflicts */}
            <Route path="/home" element={<CustomerDashboard />} />
            <Route path="/records/:typeSlug" element={<CustomerRecordList />} />
            <Route
              path="/records/:typeSlug/new"
              element={<CustomerRecordCreate />}
            />
            <Route
              path="/records/:typeSlug/:id"
              element={<CustomerRecordDetail />}
            />
          </Route>
        </Routes>
      </Refine>
    </BrowserRouter>
  );
}
