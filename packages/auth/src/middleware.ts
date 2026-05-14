import { createMiddleware } from "hono/factory";
import type { AuthContext } from "./types.js";

export const requireAuth = () =>
  createMiddleware<{ Variables: { auth: AuthContext } }>(async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "UNAUTHORIZED", message: "Missing token" }, 401);
    }
    // JWT validation implemented when Zitadel is wired up
    return next();
  });

export const requireRole = (...roles: string[]) =>
  createMiddleware<{ Variables: { auth: AuthContext } }>(async (c, next) => {
    const auth = c.get("auth");
    const hasRole = roles.some((r) => auth.roles.includes(r));
    if (!hasRole) {
      return c.json(
        { error: "FORBIDDEN", message: "Insufficient permissions" },
        403,
      );
    }
    return next();
  });
