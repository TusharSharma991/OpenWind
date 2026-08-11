import { authority, orgId } from "../authProvider.js";

// AuthNexus's Direct Password Reset API — unauthenticated, CORS-open to
// *.rokkalabs.com, called directly from the browser (no bearer token, no
// email round-trip). Not versioned — AuthNexus asked to be flagged before
// any deeper integration than this settings-page flow.

export type PasswordPolicy = {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSymbol: boolean;
};

export class PasswordResetError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => ({}));
}

export async function getPasswordPolicy(): Promise<PasswordPolicy> {
  const res = await fetch(
    `${authority}/api/auth/password-policy?org_id=${encodeURIComponent(orgId)}`,
  );
  if (!res.ok) {
    throw new PasswordResetError(
      res.status,
      "Could not load password requirements.",
    );
  }
  return (await readJson(res)) as PasswordPolicy;
}

export async function verifyCurrentPassword(
  username: string,
  password: string,
): Promise<boolean> {
  const res = await fetch(`${authority}/api/auth/verify-current-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, org_id: orgId, password }),
  });
  if (res.status === 429) {
    throw new PasswordResetError(
      429,
      "Too many attempts. Wait a bit before trying again.",
    );
  }
  if (!res.ok) {
    throw new PasswordResetError(res.status, "Could not verify password.");
  }
  const data = (await readJson(res)) as { valid?: boolean };
  return data.valid === true;
}

export async function directResetPassword(
  username: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const res = await fetch(`${authority}/api/auth/direct-reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      org_id: orgId,
      current_password: currentPassword,
      new_password: newPassword,
    }),
  });
  if (res.ok) return;

  if (res.status === 401)
    throw new PasswordResetError(401, "Current password is incorrect.");
  if (res.status === 422)
    throw new PasswordResetError(
      422,
      "New password must be at least 8 characters.",
    );
  if (res.status === 429)
    throw new PasswordResetError(
      429,
      "Too many attempts. Wait a bit before trying again.",
    );
  if (res.status === 400) {
    const data = (await readJson(res)) as { message?: string };
    throw new PasswordResetError(
      400,
      data.message ??
        "New password doesn't meet the requirements, or matches your current password.",
    );
  }
  throw new PasswordResetError(res.status, "Could not update password.");
}
