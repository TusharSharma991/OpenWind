import { describe, it, expect } from "vitest";
import { loginLink } from "./login-link.js";

describe("loginLink", () => {
  it("is the origin's /login with the slug as the org value", () => {
    expect(loginLink("acme-demo-4821", "https://app.example.com")).toBe(
      "https://app.example.com/login?org=acme-demo-4821",
    );
  });

  it("uses the page's own origin when none is given", () => {
    expect(loginLink("acme-demo-4821")).toBe(
      `${window.location.origin}/login?org=acme-demo-4821`,
    );
  });

  it("encodes a slug that ever contains a reserved character", () => {
    expect(loginLink("a b&c", "https://x.test")).toBe(
      "https://x.test/login?org=a%20b%26c",
    );
  });
});
