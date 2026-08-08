import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import type * as ReactRouterDom from "react-router-dom";

// docs/specs/my-org-view.md R1/R4 — the "Org View" toggle on My View must
// render only when GET /dashboard/org-view reports hasReports:true, and must
// never appear otherwise. This is the only AuthNexus-aware code path allowed
// on this page (§V) — everything else on dashboard.tsx is untouched.

vi.mock("@refinedev/core", () => ({
  useGetIdentity: () => ({
    data: { id: "u1", name: "Jane Doe", email: "jane@example.com" },
  }),
}));

vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof ReactRouterDom>("react-router-dom");
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock("../entity-type-context.js", () => ({
  useEntityTypes: () => ({ getTypeById: () => undefined }),
  toTypeSlug: (s: string) => s,
}));

vi.mock("../lib/notifications-client.js", () => ({
  listNotifications: () => Promise.resolve({ data: [] }),
  getUnreadCount: () => Promise.resolve(0),
  markNotificationRead: () => Promise.resolve(),
}));

const EMPTY_MY_VIEW = {
  workflows: [],
  tickets: { items: [], totalQualifying: 0 },
  dueDates: { items: [], totalQualifying: 0 },
  slaRisk: { items: [], totalQualifying: 0 },
  adminWorkflows: [],
  savedViews: [],
  pendingApprovals: { items: [], totalQualifying: 0 },
};

const mockFetchWithAuth = vi.fn((_url: string) =>
  Promise.resolve({ data: undefined as unknown }),
);
vi.mock("../lib/api.js", () => ({
  API_URL: "/api",
  fetchWithAuth: (url: string) => mockFetchWithAuth(url),
}));

const { Dashboard } = await import("./dashboard.js");

describe("Dashboard — My Org View toggle", () => {
  afterEach(() => {
    cleanup();
    mockFetchWithAuth.mockReset();
  });

  it("shows the toggle when GET /dashboard/org-view reports hasReports:true", async () => {
    mockFetchWithAuth.mockImplementation((url: string) => {
      if (url.endsWith("/dashboard/org-view")) {
        return Promise.resolve({ data: { hasReports: true } });
      }
      return Promise.resolve({ data: EMPTY_MY_VIEW });
    });

    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText(/org view/i)).toBeDefined());
  });

  it("never shows the toggle when hasReports:false", async () => {
    mockFetchWithAuth.mockImplementation((url: string) => {
      if (url.endsWith("/dashboard/org-view")) {
        return Promise.resolve({ data: { hasReports: false } });
      }
      return Promise.resolve({ data: EMPTY_MY_VIEW });
    });

    render(<Dashboard />);

    // Let both effects settle before asserting absence.
    await waitFor(() => expect(mockFetchWithAuth).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByText(/org view/i)).toBeNull();
  });

  it("never shows the toggle when the org-view probe itself fails", async () => {
    mockFetchWithAuth.mockImplementation((url: string) => {
      if (url.endsWith("/dashboard/org-view")) {
        return Promise.reject(new Error("network down"));
      }
      return Promise.resolve({ data: EMPTY_MY_VIEW });
    });

    render(<Dashboard />);

    await waitFor(() => expect(mockFetchWithAuth).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByText(/org view/i)).toBeNull();
  });
});
