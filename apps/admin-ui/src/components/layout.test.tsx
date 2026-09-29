import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type * as ReactRouterDom from "react-router-dom";

// Admin-UI sidebar restructuring: workspace nav (all roles) is now visually
// separated from an admin-only "Admin" section (docs task: split the side
// menu so admin-only items are easy to tell apart at a glance).

vi.mock("@refinedev/core", () => ({
  useGetIdentity: () => ({
    data: { id: "u1", name: "Jane Doe", email: "jane@example.com" },
  }),
  useLogout: () => ({ mutate: vi.fn() }),
}));

vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof ReactRouterDom>("react-router-dom");
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock("./notification-bell.js", () => ({
  NotificationBell: () => null,
}));

const TEST_PROJECT_ID = "test-project";
const mockGetUser = vi.fn(
  (): Promise<{ profile: Record<string, unknown> }> =>
    Promise.resolve({ profile: {} }),
);
vi.mock("../authProvider.js", () => ({
  userManager: {
    getUser: () => mockGetUser(),
    events: { addUserLoaded: vi.fn(), removeUserLoaded: vi.fn() },
  },
  // Mirrors authProvider.ts's own getRolesFromProfile — AuthNexus's real
  // claim shape (nexus_projects[].roles), not Zitadel's namespaced claim.
  getRolesFromProfile: (
    profile: Record<string, unknown> | undefined,
  ): string[] => {
    if (!profile) return [];
    const nexusProjects = (profile["nexus_projects"] ?? []) as Array<{
      id: string;
      roles: string[];
    }>;
    return nexusProjects.find((p) => p.id === TEST_PROJECT_ID)?.roles ?? [];
  },
}));

const { Layout } = await import("./layout.js");

function renderLayout(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Layout>
        <div>content</div>
      </Layout>
    </MemoryRouter>,
  );
}

function mockUserWithRoles(roles: string[]): void {
  mockGetUser.mockResolvedValue({
    profile: { nexus_projects: [{ id: TEST_PROJECT_ID, roles }] },
  });
}

describe("Layout sidebar — workspace vs admin-only sections", () => {
  afterEach(() => cleanup());

  it("shows an 'Admin' section label and the admin-only nav items for an admin", async () => {
    mockUserWithRoles(["admin"]);
    renderLayout();

    await waitFor(() => expect(screen.getByText("Admin")).not.toBeNull());
    expect(screen.getByText("Analytics")).not.toBeNull();
    expect(screen.getByText("Templates")).not.toBeNull();
    expect(screen.getByText("Automations")).not.toBeNull();
    expect(screen.getByText("System Logs")).not.toBeNull();
    expect(screen.getByText("API Keys")).not.toBeNull();
    expect(screen.getByText("On-Call")).not.toBeNull();
    // API Access Logs has no nav entry of its own anymore — its data is
    // already reachable via the API Keys page's own internal view.
    expect(screen.queryByText("API Access Logs")).toBeNull();
    // Users is workspace nav (all roles), not part of the admin-only
    // section, but still visible to an admin.
    expect(screen.getByText("Users")).not.toBeNull();
  });

  // Workflows is admin-only (moved out of the all-roles workspace nav, see
  // layout.tsx's WORKFLOWS_NAV comment) -- an agent must not see it here.
  it("hides the 'Admin' section entirely for an agent (no admin role), but still shows workspace nav including Users", async () => {
    mockUserWithRoles(["agent"]);
    renderLayout();

    // Dashboard (workspace nav) still renders once roles resolve — used as
    // the "identity has loaded" signal before asserting the negative below.
    await waitFor(() => expect(screen.getByText("Dashboard")).not.toBeNull());
    expect(screen.getByText("Records")).not.toBeNull();
    expect(screen.getByText("Users")).not.toBeNull();

    expect(screen.queryByText("Admin")).toBeNull();
    expect(screen.queryByText("Workflows")).toBeNull();
    expect(screen.queryByText("Analytics")).toBeNull();
    expect(screen.queryByText("Templates")).toBeNull();
    expect(screen.queryByText("Automations")).toBeNull();
    expect(screen.queryByText("System Logs")).toBeNull();
    expect(screen.queryByText("API Keys")).toBeNull();
    expect(screen.queryByText("On-Call")).toBeNull();
    expect(screen.queryByText("API Access Logs")).toBeNull();
  });
});
