/**
 * The login link a prospect is handed for a sandbox, /login?org=<slug> (docs/specs/multi-org-sandbox.md
 * R13). The login page looks the slug up and shows that sandbox's brand. The slug is lowercase
 * letters, digits and dashes, so encoding it is a no-op today; it stays as a guard against a slug
 * rule that ever loosens.
 */
export function loginLink(
  slug: string,
  origin: string = window.location.origin,
): string {
  return `${origin}/login?org=${encodeURIComponent(slug)}`;
}
