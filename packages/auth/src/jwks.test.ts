import { describe, it, expect, vi } from "vitest";

vi.mock("@platform/config", () => ({
  env: {
    AUTHNEXUS_ISSUER: "https://auth.rokkalabs.com",
    AUTHNEXUS_JWKS_URL: "https://auth.rokkalabs.com/api/v1/auth/jwks",
    AUTHNEXUS_AUDIENCE: "platform-api",
    AUTHNEXUS_PROJECT_ID: "project-xyz",
  },
}));

vi.mock("@platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockJwtVerify = vi.fn();
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify: (...args: unknown[]) => mockJwtVerify(...args),
}));

const { extractAuthContext, verifyJwt } = await import("./jwks.js");
import type { AuthNexusClaims } from "./types.js";
import type { JWTPayload } from "jose";

type Claims = JWTPayload & AuthNexusClaims;

const BASE_CLAIMS: Claims = {
  sub: "user-123",
  iss: "https://auth.rokkalabs.com",
  aud: ["platform-api"],
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
  email: "alice@example.com",
  org_id: "tenant-abc",
  nexus_projects: [
    { id: "project-xyz", name: "OpenWind", roles: ["agent", "admin"] },
  ],
};

describe("extractAuthContext", () => {
  it("extracts userId, tenantId, roles and email from valid claims", () => {
    const result = extractAuthContext(BASE_CLAIMS);

    expect(result).not.toBeNull();
    expect(result?.userId).toBe("user-123");
    expect(result?.tenantId).toBe("tenant-abc");
    expect(result?.email).toBe("alice@example.com");
    expect(result?.roles).toContain("agent");
    expect(result?.roles).toContain("admin");
  });

  it("returns null when sub is missing", () => {
    const claims: Claims = { ...BASE_CLAIMS, sub: undefined };
    expect(extractAuthContext(claims)).toBeNull();
  });

  it("returns null when org id claim is missing", () => {
    const claims: Claims = {
      ...BASE_CLAIMS,
      org_id: undefined,
    };
    expect(extractAuthContext(claims)).toBeNull();
  });

  it("returns empty roles array when nexus_projects claim is absent", () => {
    const claims: Claims = {
      ...BASE_CLAIMS,
      nexus_projects: undefined,
    };
    const result = extractAuthContext(claims);
    expect(result?.roles).toEqual([]);
  });

  it("returns empty roles array when nexus_projects has no grant for our project id", () => {
    const claims: Claims = {
      ...BASE_CLAIMS,
      nexus_projects: [{ id: "some-other-project", roles: ["admin"] }],
    };
    const result = extractAuthContext(claims);
    expect(result?.roles).toEqual([]);
  });

  it("returns empty string for email when claim is absent", () => {
    const claims: Claims = { ...BASE_CLAIMS, email: undefined };
    const result = extractAuthContext(claims);
    expect(result?.email).toBe("");
  });
});

// #3: audience validation must always be enforced (AUTHNEXUS_AUDIENCE is a
// required, non-empty config value — see packages/config/src/env.ts).
describe("verifyJwt", () => {
  it("always passes the configured audience to jose's jwtVerify", async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: BASE_CLAIMS });

    await verifyJwt("some.jwt.token");

    expect(mockJwtVerify).toHaveBeenCalledWith(
      "some.jwt.token",
      expect.anything(),
      expect.objectContaining({ audience: "platform-api" }),
    );
  });

  it("returns null when jwtVerify rejects (e.g. audience mismatch)", async () => {
    mockJwtVerify.mockRejectedValueOnce(new Error("audience mismatch"));

    const result = await verifyJwt("some.jwt.token");

    expect(result).toBeNull();
  });
});
