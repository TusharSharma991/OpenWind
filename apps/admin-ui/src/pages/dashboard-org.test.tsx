import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
} from "@testing-library/react";

// docs/specs/my-org-view.md R3/R1/R12 — rendering coverage for OrgDashboardBody,
// the presentational piece dashboard.tsx mounts inline (R4, amended
// 2026-08-08) — no route, no navigation involved.

const mockFetchWithAuth = vi.fn((_url: string) =>
  Promise.resolve({ data: undefined as unknown }),
);
vi.mock("../lib/api.js", () => ({
  API_URL: "/api",
  fetchWithAuth: (url: string) => mockFetchWithAuth(url),
}));

const { OrgDashboardBody } = await import("./dashboard-org.js");

const onOpenRecord = vi.fn();

const BASE_VIEW = {
  hasReports: true,
  unavailable: false,
  workflows: [],
  tickets: { items: [], totalQualifying: 0 },
  dueDates: { items: [], totalQualifying: 0 },
  slaRisk: { items: [], totalQualifying: 0 },
  teamMembers: { items: [] },
};

describe("OrgDashboardBody", () => {
  afterEach(() => {
    cleanup();
    mockFetchWithAuth.mockReset();
    onOpenRecord.mockReset();
  });

  it("shows an unavailable message (never an error) when the view reports unavailable:true", () => {
    render(
      <OrgDashboardBody
        view={{ ...BASE_VIEW, unavailable: true }}
        loading={false}
        onOpenRecord={onOpenRecord}
      />,
    );

    expect(screen.getByText(/temporarily unavailable/i)).toBeDefined();
  });

  it("shows a loading spinner while loading", () => {
    render(
      <OrgDashboardBody
        view={BASE_VIEW}
        loading={true}
        onOpenRecord={onOpenRecord}
      />,
    );

    expect(screen.getByLabelText(/loading org view/i)).toBeDefined();
  });

  it("renders team tickets/KPIs and the team roster when data is available", async () => {
    render(
      <OrgDashboardBody
        view={{
          ...BASE_VIEW,
          workflows: [
            {
              workflowId: "wf-1",
              workflowName: "Helpdesk",
              counts: [{ stateId: "open", stateName: "Open", count: 2 }],
              total: 2,
            },
          ],
          tickets: {
            items: [
              {
                entityId: "e1",
                entityTypeId: "et-1",
                entityTypeName: "Ticket",
                workflowId: "wf-1",
                workflowName: "Helpdesk",
                stateName: "Open",
                title: "Report's ticket",
                dueDate: null,
                isOverdue: false,
                assignedTo: "u1",
                assignedToName: "Report Assignee",
              },
            ],
            totalQualifying: 1,
          },
          teamMembers: {
            items: [
              {
                userId: "u1",
                name: "Priyanka Kushwaha",
                ticketCount: 4,
                overdueCount: 1,
              },
              {
                userId: "u2",
                name: "Deepika Sijwali",
                ticketCount: 0,
                overdueCount: 0,
              },
            ],
          },
        }}
        loading={false}
        onOpenRecord={onOpenRecord}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("Report's ticket")).toBeDefined(),
    );
    expect(screen.getAllByText("Helpdesk").length).toBeGreaterThan(0);
    expect(screen.getByText("Priyanka Kushwaha")).toBeDefined();
    expect(screen.getByText("Deepika Sijwali")).toBeDefined();
    expect(screen.getByText("Report Assignee")).toBeDefined();
  });

  it("filters the Team Tickets list to Overdue/Due in 2 Days/All", () => {
    const overdue = {
      entityId: "e-overdue",
      entityTypeId: "et-1",
      entityTypeName: "Ticket",
      workflowId: "wf-1",
      workflowName: "Helpdesk",
      stateName: "Open",
      title: "Overdue ticket",
      dueDate: new Date(Date.now() - 86_400_000).toISOString(),
      isOverdue: true,
      assignedTo: "u1",
      assignedToName: "Report Assignee",
    };
    const notDue = {
      entityId: "e-notdue",
      entityTypeId: "et-1",
      entityTypeName: "Ticket",
      workflowId: "wf-1",
      workflowName: "Helpdesk",
      stateName: "Open",
      title: "Not due soon",
      dueDate: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      isOverdue: false,
      assignedTo: "u1",
      assignedToName: "Report Assignee",
    };

    render(
      <OrgDashboardBody
        view={{
          ...BASE_VIEW,
          tickets: { items: [overdue, notDue], totalQualifying: 2 },
        }}
        loading={false}
        onOpenRecord={onOpenRecord}
      />,
    );

    expect(screen.getByText("Overdue ticket")).toBeDefined();
    expect(screen.getByText("Not due soon")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /^Overdue/ }));
    expect(screen.getByText("Overdue ticket")).toBeDefined();
    expect(screen.queryByText("Not due soon")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    expect(screen.getByText("Overdue ticket")).toBeDefined();
    expect(screen.getByText("Not due soon")).toBeDefined();
  });

  it("searches Team Tickets by ticket title or team member name", () => {
    const ticketA = {
      entityId: "e-a",
      entityTypeId: "et-1",
      entityTypeName: "Ticket",
      workflowId: "wf-1",
      workflowName: "Helpdesk",
      stateName: "Open",
      title: "Fix login bug",
      dueDate: null,
      isOverdue: false,
      assignedTo: "u1",
      assignedToName: "Priyanka Kushwaha",
    };
    const ticketB = {
      entityId: "e-b",
      entityTypeId: "et-1",
      entityTypeName: "Ticket",
      workflowId: "wf-1",
      workflowName: "Helpdesk",
      stateName: "Open",
      title: "Update invoice template",
      dueDate: null,
      isOverdue: false,
      assignedTo: "u2",
      assignedToName: "Deepika Sijwali",
    };

    render(
      <OrgDashboardBody
        view={{
          ...BASE_VIEW,
          tickets: { items: [ticketA, ticketB], totalQualifying: 2 },
        }}
        loading={false}
        onOpenRecord={onOpenRecord}
      />,
    );

    expect(screen.getByText("Fix login bug")).toBeDefined();
    expect(screen.getByText("Update invoice template")).toBeDefined();

    // Search by ticket title
    fireEvent.change(
      screen.getByPlaceholderText(/search by ticket or team member/i),
      {
        target: { value: "login" },
      },
    );
    expect(screen.getByText("Fix login bug")).toBeDefined();
    expect(screen.queryByText("Update invoice template")).toBeNull();

    // Search by team member name
    fireEvent.change(
      screen.getByPlaceholderText(/search by ticket or team member/i),
      {
        target: { value: "Deepika" },
      },
    );
    expect(screen.getByText("Update invoice template")).toBeDefined();
    expect(screen.queryByText("Fix login bug")).toBeNull();
  });

  it("shows an empty-roster message when the team has no members", () => {
    render(
      <OrgDashboardBody
        view={BASE_VIEW}
        loading={false}
        onOpenRecord={onOpenRecord}
      />,
    );

    expect(screen.getByText(/no direct or indirect reports/i)).toBeDefined();
  });
});
