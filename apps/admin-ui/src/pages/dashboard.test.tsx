import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
  within,
} from "@testing-library/react";
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

let mockParams: { userId?: string } = {};
vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof ReactRouterDom>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useParams: () => mockParams,
  };
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
    mockParams = {};
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

describe("Dashboard — view as subordinate (docs/specs/my-org-view.md R13)", () => {
  afterEach(() => {
    cleanup();
    mockFetchWithAuth.mockReset();
    mockParams = {};
  });

  it("fetches from /dashboard/team-member-view/:userId and shows a read-only banner with the target's name when a userId param is present", async () => {
    mockParams = { userId: "report-1" };
    mockFetchWithAuth.mockImplementation((url: string) => {
      if (url.endsWith("/dashboard/team-member-view/report-1")) {
        return Promise.resolve({
          data: {
            targetUser: { userId: "report-1", name: "Priyanka Kushwaha" },
            ...EMPTY_MY_VIEW,
          },
        });
      }
      // Should never be called in view-as mode — asserted below too.
      return Promise.resolve({ data: { hasReports: true } });
    });

    render(<Dashboard />);

    await waitFor(() =>
      expect(screen.getAllByText(/priyanka kushwaha/i).length).toBeGreaterThan(
        0,
      ),
    );
    expect(screen.getByText(/read-only/i)).toBeDefined();
    expect(
      mockFetchWithAuth.mock.calls.some((c) =>
        String(c[0]).endsWith("/dashboard/my-view"),
      ),
    ).toBe(false);
  });

  it("never probes /dashboard/org-view or shows the Org View toggle while viewing as a subordinate", async () => {
    mockParams = { userId: "report-1" };
    mockFetchWithAuth.mockImplementation((url: string) => {
      if (url.endsWith("/dashboard/team-member-view/report-1")) {
        return Promise.resolve({
          data: {
            targetUser: { userId: "report-1", name: "Priyanka Kushwaha" },
            ...EMPTY_MY_VIEW,
          },
        });
      }
      return Promise.resolve({ data: { hasReports: true } });
    });

    render(<Dashboard />);

    await waitFor(() =>
      expect(screen.getAllByText(/priyanka kushwaha/i).length).toBeGreaterThan(
        0,
      ),
    );
    expect(
      mockFetchWithAuth.mock.calls.some((c) =>
        String(c[0]).endsWith("/dashboard/org-view"),
      ),
    ).toBe(false);
    expect(screen.queryByText(/org view/i)).toBeNull();
  });
});

describe("Dashboard — KPI tiles filter the My Tickets list", () => {
  afterEach(() => {
    cleanup();
    mockFetchWithAuth.mockReset();
    mockParams = {};
  });

  const overdueTicket = {
    entityId: "e-overdue",
    entityTypeId: "et-1",
    entityTypeName: "Ticket",
    workflowId: "wf-1",
    workflowName: "Helpdesk",
    stateName: "Open",
    title: "Overdue ticket",
    dueDate: new Date(Date.now() - 86_400_000).toISOString(),
    isOverdue: true,
  };
  const dueThisWeekTicket = {
    entityId: "e-dueweek",
    entityTypeId: "et-1",
    entityTypeName: "Ticket",
    workflowId: "wf-1",
    workflowName: "Helpdesk",
    stateName: "Open",
    title: "Due this week ticket",
    dueDate: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    isOverdue: false,
  };
  const atRiskTicket = {
    entityId: "e-atrisk",
    entityTypeId: "et-1",
    entityTypeName: "Ticket",
    workflowId: "wf-1",
    workflowName: "Helpdesk",
    stateName: "Open",
    title: "At risk ticket",
    dueDate: null,
    isOverdue: false,
  };
  const VIEW_WITH_TICKETS = {
    ...EMPTY_MY_VIEW,
    tickets: {
      items: [overdueTicket, dueThisWeekTicket, atRiskTicket],
      totalQualifying: 3,
    },
    slaRisk: {
      items: [
        {
          entityId: "e-atrisk",
          entityTypeId: "et-1",
          entityTypeName: "Ticket",
          title: "At risk ticket",
          workflowId: "wf-1",
          stateName: "Open",
          hoursOver: 5,
        },
      ],
      totalQualifying: 1,
    },
  };

  function mockMyView(): void {
    mockFetchWithAuth.mockImplementation((url: string) => {
      if (url.endsWith("/dashboard/org-view")) {
        return Promise.resolve({ data: { hasReports: false } });
      }
      return Promise.resolve({ data: VIEW_WITH_TICKETS });
    });
  }

  // The SLA Risk side panel independently lists "At risk ticket" too (it's a
  // separate signal, §V), so ticket-list assertions scope to the My Tickets
  // <table> via `within` to avoid colliding with that panel's own rendering.
  function ticketTable(): HTMLElement {
    return screen.getByRole("table");
  }

  it("defaults to 'My Tickets' active, showing every ticket", async () => {
    mockMyView();
    render(<Dashboard />);

    await waitFor(() =>
      expect(within(ticketTable()).getByText("Overdue ticket")).toBeDefined(),
    );
    expect(
      within(ticketTable()).getByText("Due this week ticket"),
    ).toBeDefined();
    expect(within(ticketTable()).getByText("At risk ticket")).toBeDefined();

    const kpiStrip = document.querySelector(".dash-kpi");
    const myTicketsTile = within(kpiStrip as HTMLElement).getByText(
      "My Tickets",
    ).parentElement?.parentElement;
    expect(myTicketsTile?.style.background).toBe("rgb(0, 111, 230)");
  });

  it("filters to only overdue tickets when the Overdue tile is clicked, and highlights it", async () => {
    mockMyView();
    render(<Dashboard />);

    await waitFor(() =>
      expect(within(ticketTable()).getByText("Overdue ticket")).toBeDefined(),
    );

    fireEvent.click(screen.getByText("Overdue"));

    expect(within(ticketTable()).getByText("Overdue ticket")).toBeDefined();
    expect(
      within(ticketTable()).queryByText("Due this week ticket"),
    ).toBeNull();
    expect(within(ticketTable()).queryByText("At risk ticket")).toBeNull();
  });

  it("filters to only at-risk tickets when the At SLA Risk tile is clicked", async () => {
    mockMyView();
    render(<Dashboard />);

    await waitFor(() =>
      expect(within(ticketTable()).getByText("Overdue ticket")).toBeDefined(),
    );

    fireEvent.click(screen.getByText("At SLA Risk"));

    expect(within(ticketTable()).getByText("At risk ticket")).toBeDefined();
    expect(within(ticketTable()).queryByText("Overdue ticket")).toBeNull();
    expect(
      within(ticketTable()).queryByText("Due this week ticket"),
    ).toBeNull();
  });

  it("filters to only tickets due this week when the Due This Week tile is clicked", async () => {
    mockMyView();
    render(<Dashboard />);

    await waitFor(() =>
      expect(within(ticketTable()).getByText("Overdue ticket")).toBeDefined(),
    );

    fireEvent.click(screen.getByText("Due This Week"));

    expect(
      within(ticketTable()).getByText("Due this week ticket"),
    ).toBeDefined();
    expect(within(ticketTable()).queryByText("Overdue ticket")).toBeNull();
    expect(within(ticketTable()).queryByText("At risk ticket")).toBeNull();
  });
});
