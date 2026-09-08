import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import {
  OriginTag,
  OriginCornerBadge,
  OriginHeaderPill,
  OriginDetailLine,
} from "./origin-tag.js";

afterEach(cleanup);

describe("OriginTag", () => {
  it("renders nothing when origin is null", () => {
    const { container } = render(<OriginTag origin={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when origin is undefined", () => {
    const { container } = render(<OriginTag origin={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders only the collapsed "External" label by default — app/person detail is not shown until clicked', () => {
    render(
      <OriginTag
        origin={{
          mechanism: "api",
          appName: "Acme Sync",
          performerUserId: "378676050449661954",
          performerDisplayName: "Jane Doe",
        }}
      />,
    );
    expect(screen.getByText("External")).toBeTruthy();
    expect(screen.queryByText("Acme Sync")).toBeNull();
    expect(screen.queryByText("Jane Doe")).toBeNull();
    expect(screen.queryByText("378676050449661954")).toBeNull();
  });

  it("expands to show app name and resolved performer name on click, and collapses again on a second click", () => {
    render(
      <OriginTag
        origin={{
          mechanism: "api",
          appName: "Acme Sync",
          performerUserId: "378676050449661954",
          performerDisplayName: "Jane Doe",
        }}
      />,
    );
    const button = screen.getByRole("button");
    fireEvent.click(button);
    expect(screen.getByText("Acme Sync")).toBeTruthy();
    expect(screen.getByText("Jane Doe")).toBeTruthy();

    fireEvent.click(button);
    expect(screen.queryByText("Acme Sync")).toBeNull();
    expect(screen.queryByText("Jane Doe")).toBeNull();
  });

  // Found via live testing (2026-09-08): the expanded app/person text had a
  // maxWidth + ellipsis truncation that clipped long real values -- the
  // whole point of expanding is to see the FULL detail, so no width/overflow
  // constraint may be applied to these two spans.
  it("shows the full app name and performer name when expanded, with no width/ellipsis truncation", () => {
    render(
      <OriginTag
        origin={{
          mechanism: "api",
          appName: "A Very Long Third Party Application Name Indeed",
          performerUserId: "378676050449661954",
          performerDisplayName: "A Very Long Person Display Name Indeed",
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    const appNameEl = screen.getByText(
      "A Very Long Third Party Application Name Indeed",
    );
    const personNameEl = screen.getByText(
      "A Very Long Person Display Name Indeed",
    );
    expect(appNameEl.style.maxWidth).toBe("");
    expect(appNameEl.style.textOverflow).toBe("");
    expect(personNameEl.style.maxWidth).toBe("");
    expect(personNameEl.style.textOverflow).toBe("");
  });

  it("falls back to the raw performer id when no display name resolved, once expanded", () => {
    render(
      <OriginTag
        origin={{
          mechanism: "api",
          appName: "Acme Sync",
          performerUserId: "jane@acme.com",
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("jane@acme.com")).toBeTruthy();
  });

  it('renders "Redirected" for mechanism handoff, collapsed by default', () => {
    render(
      <OriginTag
        origin={{
          mechanism: "handoff",
          appName: "Acme Portal",
          performerUserId: "real-user-id",
          performerDisplayName: "Real User",
        }}
      />,
    );
    expect(screen.getByText("Redirected")).toBeTruthy();
    expect(screen.queryByText("Acme Portal")).toBeNull();
  });

  it("still carries the full detail in its title tooltip while collapsed, so hover works without clicking", () => {
    render(
      <OriginTag
        origin={{
          mechanism: "api",
          appName: "Acme Sync",
          performerUserId: "378676050449661954",
          performerDisplayName: "Jane Doe",
        }}
      />,
    );
    expect(screen.getByTitle("Created via Acme Sync by Jane Doe")).toBeTruthy();
  });
});

describe("OriginCornerBadge", () => {
  it("renders nothing when origin is null", () => {
    const { container } = render(<OriginCornerBadge origin={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders only the mechanism label, not app/person detail", () => {
    render(
      <OriginCornerBadge
        origin={{
          mechanism: "api",
          appName: "Acme Sync",
          performerUserId: "378676050449661954",
          performerDisplayName: "Jane Doe",
        }}
      />,
    );
    expect(screen.getByText("External")).toBeTruthy();
    expect(screen.queryByText("Acme Sync")).toBeNull();
    expect(screen.queryByText("Jane Doe")).toBeNull();
  });

  it("carries the full detail in its title tooltip", () => {
    render(
      <OriginCornerBadge
        origin={{
          mechanism: "handoff",
          appName: "Acme Portal",
          performerUserId: "real-user-id",
          performerDisplayName: "Real User",
        }}
      />,
    );
    expect(
      screen.getByTitle("Redirected · Created via Acme Portal by Real User"),
    ).toBeTruthy();
  });
});

describe("OriginHeaderPill", () => {
  it("renders nothing when origin is null", () => {
    const { container } = render(<OriginHeaderPill origin={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders only the mechanism label, matching the corner badge's compactness", () => {
    render(
      <OriginHeaderPill
        origin={{
          mechanism: "api",
          appName: "Acme Sync",
          performerUserId: "378676050449661954",
          performerDisplayName: "Jane Doe",
        }}
      />,
    );
    expect(screen.getByText("External")).toBeTruthy();
    expect(screen.queryByText("Acme Sync")).toBeNull();
  });
});

describe("OriginDetailLine", () => {
  it("renders nothing when origin is null", () => {
    const { container } = render(<OriginDetailLine origin={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the app name and resolved performer name for a tagged origin", () => {
    render(
      <OriginDetailLine
        origin={{
          mechanism: "api",
          appName: "Acme Sync",
          performerUserId: "378676050449661954",
          performerDisplayName: "Jane Doe",
        }}
      />,
    );
    expect(screen.getByText("Acme Sync")).toBeTruthy();
    expect(screen.getByText("Jane Doe")).toBeTruthy();
  });
});
