import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "../i18n.js";

vi.mock("../authProvider.js", () => ({
  userManager: {
    removeUser: vi.fn(),
    signinRedirect: vi.fn(),
  },
}));

const { Login } = await import("./login.js");
const { userManager } = await import("../authProvider.js");

function renderAt(path: string): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Login />
    </MemoryRouter>,
  );
}

beforeAll(() => {
  // This Node/jsdom combination leaves the bare `localStorage` global
  // disabled unless --localstorage-file is passed to node — unrelated to
  // this i18n change, stub it so the component's existing theme-preference
  // read doesn't throw during render.
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  });
});

describe("Login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders translated strings from the i18n common namespace", () => {
    renderAt("/login");

    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Login" })).toBeDefined();
    expect(screen.getByText("Contact us")).toBeDefined();
  });

  it("'Contact us' opens a Gmail trial-request draft to info@rokkalabs.com in a new tab", () => {
    renderAt("/login");

    const link = screen.getByRole("link", { name: "Contact us" });
    const href = new URL(link.getAttribute("href") ?? "");
    expect(href.origin).toBe("https://mail.google.com");
    expect(href.searchParams.get("to")).toBe("info@rokkalabs.com");
    expect(href.searchParams.get("su")).toMatch(/trial/i);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("shows the navbar's logo (icon + wordmark) and no footer", () => {
    const { container } = renderAt("/login");

    const logo = container.querySelector(".lp-float-logo");
    expect(logo?.querySelector("img.logo-icon")?.getAttribute("src")).toBe(
      "/favicon.svg",
    );
    expect(logo?.querySelector(".logo-text")?.textContent).toBe("OpenWind");
    expect(container.querySelector("footer")).toBeNull();
    expect(screen.queryByText(/© 2026/)).toBeNull();
  });

  // Hosted ticket-create handoff (docs/specs/hosted-ticket-create-handoff.md,
  // spec R2 + T5) — the default login flow (no handoff query params) must be
  // completely unaffected by this feature's addition.
  it("with no handoff query params, a manual sign-in still calls signinRedirect with prompt: login and removeUser first", async () => {
    renderAt("/login");
    screen.getByRole("button", { name: "Login" }).click();

    await waitFor(() => {
      expect(userManager.removeUser).toHaveBeenCalled();
    });
    expect(userManager.signinRedirect).toHaveBeenCalledWith({
      prompt: "login",
    });
  });

  it("shows a sign-in failure to the user, logs it, and re-enables the button", async () => {
    const failure = new Error(
      "Crypto.subtle is available only in secure contexts (HTTPS)",
    );
    vi.mocked(userManager.signinRedirect).mockRejectedValueOnce(failure);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    renderAt("/login");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Login" }));

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        "Sign-in failed before redirect:",
        failure,
      );
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Login" }).hasAttribute("disabled"),
      ).toBe(false);
    });
    // A fixed sentence for the user; the raw error stays out of the page.
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(
      "Sign-in failed. If this continues, please contact support.",
    );
    expect(document.body.textContent).not.toContain("Crypto.subtle");
    consoleError.mockRestore();
  });

  it("shows the same message when the handoff sign-in fails", async () => {
    vi.mocked(userManager.signinRedirect).mockRejectedValueOnce(
      new Error("discovery failed"),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    renderAt(
      "/login?workflowId=11111111-1111-4111-a111-111111111111&entityTypeId=22222222-2222-4222-a222-222222222222&appClientId=app-1",
    );
    fireEvent.click(screen.getByRole("button", { name: "Login" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Sign-in failed. If this continues, please contact support.",
    );
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  // Corrected after live testing: the handoff redirect is NOT auto-triggered
  // on mount (that skipped straight to Zitadel's hosted login page with no
  // visible OpenWind screen) -- the user still sees this page and clicks
  // Sign In themselves, same as the default flow.
  it("with handoff query params present, does nothing until the user clicks Sign In", async () => {
    renderAt(
      "/login?workflowId=11111111-1111-4111-a111-111111111111&entityTypeId=22222222-2222-4222-a222-222222222222&title=Client+dinner&remark=needs+approval&appClientId=app-1",
    );

    await new Promise((r) => setTimeout(r, 0));
    expect(userManager.signinRedirect).not.toHaveBeenCalled();
  });

  it("with handoff query params present, clicking Sign In calls signinRedirect with state and WITHOUT prompt: login or removeUser (spec R1)", async () => {
    renderAt(
      "/login?workflowId=11111111-1111-4111-a111-111111111111&entityTypeId=22222222-2222-4222-a222-222222222222&title=Client+dinner&remark=needs+approval&appClientId=app-1",
    );
    screen.getByRole("button", { name: "Login" }).click();

    await waitFor(() => {
      expect(userManager.signinRedirect).toHaveBeenCalledWith({
        state: {
          workflowId: "11111111-1111-4111-a111-111111111111",
          entityTypeId: "22222222-2222-4222-a222-222222222222",
          prefillFields: { title: "Client dinner", remark: "needs approval" },
          appClientId: "app-1",
        },
      });
    });
    expect(userManager.removeUser).not.toHaveBeenCalled();
  });

  it("ignores handoff params missing workflowId or entityTypeId and falls back to normal login on click", async () => {
    renderAt("/login?title=Client+dinner");
    screen.getByRole("button", { name: "Login" }).click();

    await waitFor(() => {
      expect(userManager.signinRedirect).toHaveBeenCalledWith({
        prompt: "login",
      });
    });
    expect(userManager.removeUser).toHaveBeenCalled();
  });

  // issue #544 — UUID_RE defence-in-depth guard in readHandoffParams
  it("rejects a non-UUID workflowId and falls back to normal login", async () => {
    renderAt(
      "/login?workflowId=not-a-uuid&entityTypeId=22222222-2222-4222-a222-222222222222&appClientId=app-1",
    );
    screen.getByRole("button", { name: "Login" }).click();

    await waitFor(() => {
      expect(userManager.signinRedirect).toHaveBeenCalledWith({
        prompt: "login",
      });
    });
    expect(userManager.removeUser).toHaveBeenCalled();
  });

  it("rejects a non-UUID entityTypeId and falls back to normal login", async () => {
    renderAt(
      "/login?workflowId=11111111-1111-4111-a111-111111111111&entityTypeId=et-1&appClientId=app-1",
    );
    screen.getByRole("button", { name: "Login" }).click();

    await waitFor(() => {
      expect(userManager.signinRedirect).toHaveBeenCalledWith({
        prompt: "login",
      });
    });
    expect(userManager.removeUser).toHaveBeenCalled();
  });

  it("accepts all fields when workflowId/entityTypeId are valid UUIDs and appClientId is present (positive path)", async () => {
    renderAt(
      "/login?workflowId=11111111-1111-4111-a111-111111111111&entityTypeId=22222222-2222-4222-a222-222222222222&appClientId=app-1",
    );
    screen.getByRole("button", { name: "Login" }).click();

    await waitFor(() => {
      expect(userManager.signinRedirect).toHaveBeenCalledWith({
        state: {
          workflowId: "11111111-1111-4111-a111-111111111111",
          entityTypeId: "22222222-2222-4222-a222-222222222222",
          prefillFields: {},
          appClientId: "app-1",
        },
      });
    });
    expect(userManager.removeUser).not.toHaveBeenCalled();
  });

  // docs/specs/third-party-api-origin-tagging.md R2 -- appClientId is
  // required exactly like workflowId/entityTypeId (not optional), so a
  // handoff URL missing it must be treated identically: fall back to normal
  // login, never a partial/untagged handoff attempt.
  it("ignores handoff params missing appClientId and falls back to normal login on click", async () => {
    renderAt(
      "/login?workflowId=11111111-1111-4111-a111-111111111111&entityTypeId=22222222-2222-4222-a222-222222222222&title=Client+dinner",
    );
    screen.getByRole("button", { name: "Login" }).click();

    await waitFor(() => {
      expect(userManager.signinRedirect).toHaveBeenCalledWith({
        prompt: "login",
      });
    });
    expect(userManager.removeUser).toHaveBeenCalled();
  });
});

// docs/specs/multi-org-sandbox.md R13 -- a sandbox's own login link shows its brand; every other
// way of reaching the page is the generic OpenWind login.
describe("Login brand for a sandbox login link", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function ok(data: unknown): Response {
    return new Response(JSON.stringify({ data }), { status: 200 });
  }

  function brand(container: HTMLElement): Element | null {
    return container.querySelector(".lp-float-logo");
  }

  it("shows the sandbox's logo and name instead of the OpenWind brand", async () => {
    mockFetch.mockResolvedValue(
      ok({ name: "Acme Demo", logo: "data:image/png;base64,AAAA" }),
    );

    const { container } = renderAt("/login?org=3f9a1c7e2b4d8a60");

    await waitFor(() =>
      expect(brand(container)?.textContent).toContain("Acme Demo"),
    );
    expect(brand(container)?.textContent).not.toContain("OpenWind");
    expect(
      brand(container)?.querySelector('img[src="data:image/png;base64,AAAA"]'),
    ).not.toBeNull();
    expect(
      brand(container)?.querySelector('img[src="/favicon.svg"]'),
    ).toBeNull();
  });

  it("shows the initials tile and name when the sandbox has no logo", async () => {
    mockFetch.mockResolvedValue(ok({ name: "Acme Demo", logo: null }));

    const { container } = renderAt("/login?org=3f9a1c7e2b4d8a60");

    await waitFor(() =>
      expect(brand(container)?.textContent).toContain("Acme Demo"),
    );
    expect(brand(container)?.textContent).toContain("AD");
    expect(brand(container)?.querySelector("img")).toBeNull();
  });

  it("names the sandbox in the card's breadcrumb instead of OpenWind", async () => {
    mockFetch.mockResolvedValue(ok({ name: "Acme Demo", logo: null }));

    const { container } = renderAt("/login?org=3f9a1c7e2b4d8a60");

    await waitFor(() => {
      const crumb = container.querySelector(".lp-notebook-crumb");
      expect(crumb?.textContent).toContain("Acme Demo");
    });
    const crumb = container.querySelector(".lp-notebook-crumb");
    expect(crumb?.textContent).not.toContain("OpenWind");
    expect(crumb?.textContent).toContain("Sign in");
  });

  it("keeps the generic breadcrumb on plain /login", () => {
    const { container } = renderAt("/login");

    const crumb = container.querySelector(".lp-notebook-crumb");
    expect(crumb?.textContent).toContain("OpenWind");
    expect((crumb?.querySelector("span") as HTMLElement).style.visibility).toBe(
      "",
    );
  });

  it("holds the breadcrumb's brand invisibly while the lookup runs", () => {
    mockFetch.mockReturnValue(new Promise(() => undefined));

    const { container } = renderAt("/login?org=3f9a1c7e2b4d8a60");

    const brandSpan = container.querySelector(
      ".lp-notebook-crumb span",
    ) as HTMLElement;
    expect(brandSpan.style.visibility).toBe("hidden");
  });

  it("keeps the generic breadcrumb when the lookup misses", async () => {
    mockFetch.mockResolvedValue(new Response("{}", { status: 404 }));

    const { container } = renderAt("/login?org=3f9a1c7e2b4d8a60");

    await waitFor(() => {
      const brandSpan = container.querySelector(
        ".lp-notebook-crumb span",
      ) as HTMLElement;
      expect(brandSpan.style.visibility).toBe("");
    });
    expect(
      container.querySelector(".lp-notebook-crumb")?.textContent,
    ).toContain("OpenWind");
  });

  it("sets the browser tab title to the sandbox's name, and puts it back on leaving", async () => {
    mockFetch.mockResolvedValue(ok({ name: "Acme Demo", logo: null }));
    const before = document.title;

    const view = renderAt("/login?org=3f9a1c7e2b4d8a60");

    await waitFor(() => expect(document.title).toBe("Acme Demo"));
    view.unmount();
    expect(document.title).toBe(before);
  });

  it("leaves the tab title alone on plain /login and on a miss", async () => {
    const before = document.title;
    renderAt("/login");
    expect(document.title).toBe(before);
    cleanup();

    mockFetch.mockResolvedValue(new Response("{}", { status: 404 }));
    renderAt("/login?org=3f9a1c7e2b4d8a60");
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(document.title).toBe(before);
  });

  it("does not look a readable slug up: only a login key is sent", () => {
    const { container } = renderAt("/login?org=acme-demo-4821");

    expect(mockFetch).not.toHaveBeenCalled();
    expect(brand(container)?.textContent).toBe("OpenWind");
  });

  it("leaves the rest of the page, and signing in, exactly as before", async () => {
    mockFetch.mockResolvedValue(ok({ name: "Acme Demo", logo: null }));

    renderAt("/login?org=3f9a1c7e2b4d8a60");
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Login" }));
    await waitFor(() =>
      expect(userManager.signinRedirect).toHaveBeenCalledWith({
        prompt: "login",
      }),
    );
  });

  it("does not wait for the lookup before signing in", () => {
    mockFetch.mockReturnValue(new Promise(() => undefined));

    renderAt("/login?org=3f9a1c7e2b4d8a60");

    expect(
      screen.getByRole("button", { name: "Login" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("holds the brand's space invisibly while the lookup runs, never flashing OpenWind", () => {
    mockFetch.mockReturnValue(new Promise(() => undefined));

    const { container } = renderAt("/login?org=3f9a1c7e2b4d8a60");

    const text = brand(container)?.querySelector(".logo-text") as HTMLElement;
    expect(text.style.visibility).toBe("hidden");
  });

  it("makes no lookup at all, and shows OpenWind at once, on plain /login", () => {
    const { container } = renderAt("/login");

    expect(mockFetch).not.toHaveBeenCalled();
    const text = brand(container)?.querySelector(".logo-text") as HTMLElement;
    expect(text.textContent).toBe("OpenWind");
    expect(text.style.visibility).toBe("");
  });

  it("ignores an org value that is not a login key, with no lookup", () => {
    const { container } = renderAt("/login?org=%3Cscript%3E");

    expect(mockFetch).not.toHaveBeenCalled();
    expect(brand(container)?.textContent).toBe("OpenWind");
  });

  it.each([
    ["an unknown key (404)", () => new Response("{}", { status: 404 })],
    ["a rate limit (429)", () => new Response("{}", { status: 429 })],
    [
      "a network failure",
      () => Promise.reject(new TypeError("Failed to fetch")),
    ],
  ])(
    "falls back to the generic OpenWind login for %s",
    async (_label, answer) => {
      mockFetch.mockImplementation(() => Promise.resolve(answer()));

      const { container } = renderAt("/login?org=3f9a1c7e2b4d8a60");

      await waitFor(() => {
        const text = brand(container)?.querySelector(
          ".logo-text",
        ) as HTMLElement;
        expect(text.style.visibility).toBe("");
      });
      expect(brand(container)?.textContent).toBe("OpenWind");
      expect(screen.getByRole("button", { name: "Login" })).toBeDefined();
    },
  );

  it("carries the org value into the lookup only, never into the sign-in redirect", async () => {
    mockFetch.mockResolvedValue(ok({ name: "Acme Demo", logo: null }));

    renderAt("/login?org=3f9a1c7e2b4d8a60");
    fireEvent.click(screen.getByRole("button", { name: "Login" }));

    await waitFor(() => expect(userManager.signinRedirect).toHaveBeenCalled());
    expect(userManager.signinRedirect).toHaveBeenCalledWith({
      prompt: "login",
    });
  });
});
