export interface AuthContext {
  userId: string;
  tenantId: string;
  roles: string[];
  email: string;
  displayName: string;
  orgId?: string | undefined;
}

// AuthNexus JWT / userinfo claim shape — confirmed against a real token, NOT
// Zitadel's nested "urn:zitadel:iam:*" namespace. AuthNexus's OIDC scopes
// borrow Zitadel-style scope *names* (e.g. urn:zitadel:iam:org:project:id:…:aud)
// but the actual claims returned are flat/custom.
export interface NexusProjectGrant {
  id: string;
  name?: string;
  roles: string[];
}

export interface AuthNexusClaims {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  org_id?: string;
  project_id?: string;
  nexus_projects?: NexusProjectGrant[];
}
