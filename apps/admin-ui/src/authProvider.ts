import { UserManager, WebStorageStateStore } from "oidc-client-ts";
import type { User } from "oidc-client-ts";
import type { AuthProvider } from "@refinedev/core";

declare const window: Window & {
  __CONFIG__?: {
    AUTHNEXUS_AUTHORITY?: string;
    AUTHNEXUS_CLIENT_ID?: string;
    AUTHNEXUS_ORG_ID?: string;
    AUTHNEXUS_PROJECT_ID?: string;
  };
};

// Runtime config (Docker) wins; Vite build-time env vars (local dev) are the fallback.
// import.meta.env keys are not statically declared so we cast to a generic record.
const viteEnv = import.meta.env as Record<string, string | undefined>;
const cfg = window.__CONFIG__ ?? {};
export const authority =
  cfg.AUTHNEXUS_AUTHORITY ??
  viteEnv["VITE_AUTH_AUTHORITY"] ??
  "https://auth.rokkalabs.com";
const clientId = cfg.AUTHNEXUS_CLIENT_ID ?? viteEnv["VITE_CLIENT_ID"] ?? "";
export const orgId = cfg.AUTHNEXUS_ORG_ID ?? viteEnv["VITE_ORG_ID"] ?? "";
const projectId = cfg.AUTHNEXUS_PROJECT_ID ?? viteEnv["VITE_PROJECT_ID"] ?? "";

// AuthNexus's actual claim shape (confirmed against a real token) is
// flat/custom, not Zitadel's "urn:zitadel:iam:*" namespace — roles live
// per-project under nexus_projects[].roles. Single source of truth for role
// extraction — used by getPermissions() below and by Layout's RBAC checks.
export function getRolesFromProfile(
  profile: Record<string, unknown> | undefined,
): string[] {
  if (!profile) return [];
  const nexusProjects = (profile["nexus_projects"] ?? []) as Array<{
    id: string;
    roles: string[];
  }>;
  const projectGrant = nexusProjects.find((p) => p.id === projectId);
  return projectGrant?.roles ?? [];
}

// AuthNexus has no OIDC discovery document — every endpoint is hardcoded here
// rather than derived from `authority` (which would otherwise trigger a
// GET {authority}/.well-known/openid-configuration lookup that AuthNexus doesn't serve).
export const userManager = new UserManager({
  authority,
  client_id: clientId,
  redirect_uri: window.location.origin + "/auth/callback",
  post_logout_redirect_uri: window.location.origin + "/login",
  response_type: "code",
  // Public/PKCE client — no client_secret. oidc-client-ts generates the
  // code_verifier/code_challenge automatically for response_type "code".
  scope: `openid profile email role offline_access urn:zitadel:iam:user:resourceowner urn:zitadel:iam:org:project:id:${projectId}:aud`,
  // AuthNexus's /login page needs org_id/project_id as query params (not just
  // in the scope string) to resolve tenant context — without these it falls
  // back to a literal "None" org_id rather than erroring.
  extraQueryParams: {
    org_id: orgId,
    project_id: projectId,
    project_name: "JMV Work",
    primary_origin: window.location.origin,
  },
  metadata: {
    issuer: authority,
    authorization_endpoint: `${authority}/api/v1/auth/authorize`,
    token_endpoint: `${authority}/api/v1/auth/token`,
    userinfo_endpoint: `${authority}/oidc/v1/userinfo`,
    jwks_uri: `${authority}/api/v1/auth/jwks`,
    end_session_endpoint: `${authority}/oidc/v1/end_session`,
  },
  userStore: new WebStorageStateStore({ store: window.localStorage }),
  automaticSilentRenew: true,
  loadUserInfo: true,
});

// ── Auth-ready gate ───────────────────────────────────────────────────────────
// Resolves as soon as a valid access_token is confirmed available.
// — On page reload: resolves immediately (user already in localStorage).
// — On initial login: resolves when signinCallback() fires the userLoaded event.
// fetchWithAuth awaits this before reading the token so it never sends a
// request with a missing Bearer header due to a post-callback race condition.

let _authReadyResolve: (() => void) | undefined;
const _authReady = new Promise<void>((resolve) => {
  _authReadyResolve = resolve;
});

// Check localStorage immediately (page reload path).
void userManager.getUser().then((u) => {
  if (u && !u.expired) _authReadyResolve?.();
});

// Resolve whenever a user is stored (initial login path).
userManager.events.addUserLoaded((_u: User) => {
  _authReadyResolve?.();
});

// 3 s safety-valve: never block requests longer than this.
const _authTimeout = new Promise<void>((r) => setTimeout(r, 3000));

export function waitForAuth(): Promise<void> {
  return Promise.race([_authReady, _authTimeout]);
}

// Attempt a silent token refresh using the stored refresh_token.
// Returns the new access_token on success, null on failure.
//
// Single-flight: concurrent 401s (e.g. several in-flight requests all racing
// at token expiry) previously each fired their own independent signinSilent()
// call — N parallel calls racing on the same localStorage write. All callers
// arriving while a refresh is already in progress now share that one promise.
let _pendingRefresh: Promise<string | null> | undefined;

export function silentRefresh(): Promise<string | null> {
  if (_pendingRefresh) return _pendingRefresh;

  _pendingRefresh = userManager
    .signinSilent()
    .then((user) => user?.access_token ?? null)
    .catch(() => null)
    .finally(() => {
      _pendingRefresh = undefined;
    });

  return _pendingRefresh;
}

export const authProvider: AuthProvider = {
  login: async () => {
    await userManager.signinRedirect();
    return { success: true };
  },
  logout: async () => {
    try {
      const user = await userManager.getUser();
      await userManager.clearStaleState();
      // Ends the session at AuthNexus too, not just locally — signoutRedirect
      // navigates the browser to AuthNexus's end-session endpoint, which then
      // redirects back to post_logout_redirect_uri. It clears the local user
      // itself, so no separate removeUser() call is needed.
      await userManager.signoutRedirect(
        user?.id_token ? { id_token_hint: user.id_token } : undefined,
      );
      return { success: true };
    } catch (err) {
      console.error("Failed to sign out via AuthNexus:", err);
      await userManager.removeUser();
      await userManager.clearStaleState();
      return { success: true, redirectTo: "/login" };
    }
  },
  onError: (error: unknown) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      "isAuthError" in error
    ) {
      const e = error as { status: number; isAuthError: boolean };
      if (e.status === 401 && e.isAuthError) {
        return Promise.resolve({
          logout: true,
          redirectTo: "/login",
          error: error as unknown as Error,
        });
      }
    }
    return Promise.resolve({ error: error as unknown as Error });
  },
  check: async () => {
    if (window.location.pathname === "/auth/callback") {
      return { authenticated: true };
    }
    const user = await userManager.getUser();
    if (user && !user.expired) {
      return { authenticated: true };
    }
    // Token expired — attempt silent refresh before giving up.
    if (user?.refresh_token) {
      const newToken = await silentRefresh();
      if (newToken) return { authenticated: true };
    }
    return {
      authenticated: false,
      redirectTo: "/login",
      error: new Error("Unauthenticated"),
    };
  },
  getPermissions: async () => {
    const user = await userManager.getUser();
    return getRolesFromProfile(
      user?.profile as Record<string, unknown> | undefined,
    );
  },
  getIdentity: async () => {
    const user = await userManager.getUser();
    if (user?.profile) {
      return {
        id: user.profile.sub,
        name:
          user.profile.name ??
          user.profile.preferred_username ??
          user.profile.email ??
          "Admin User",
        email: user.profile.email ?? "",
        avatar:
          user.profile.picture ??
          `https://api.dicebear.com/7.x/initials/svg?seed=${user.profile.name ?? "Admin"}&fontSize=38&fontWeight=700&chars=2`,
      };
    }
    return null;
  },
};
