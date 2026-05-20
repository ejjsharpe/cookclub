import type { MiddlewareHandler } from "hono";

import type { Env } from "../types";

export const requestLogger: MiddlewareHandler<{ Bindings: Env }> = async (
  c,
  next,
) => {
  const requestId = c.req.header("cf-ray") || crypto.randomUUID();
  const start = Date.now();
  c.header("x-request-id", requestId);

  await next();

  const url = new URL(c.req.url);
  console.log(
    JSON.stringify({
      requestId,
      method: c.req.method,
      path: url.pathname,
      status: c.res.status,
      durationMs: Date.now() - start,
    }),
  );
};
