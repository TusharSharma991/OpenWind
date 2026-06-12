import { createMiddleware } from "hono/factory";
import { randomUUID } from "node:crypto";

type Vars = { Variables: { requestId: string } };

export const correlationId = (): ReturnType<typeof createMiddleware<Vars>> =>
  createMiddleware<Vars>(async (c, next) => {
    const id = c.req.header("x-request-id") ?? randomUUID();
    c.set("requestId", id);
    c.header("x-request-id", id);
    await next();
  });
