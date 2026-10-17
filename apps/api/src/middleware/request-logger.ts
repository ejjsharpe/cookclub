import type { MiddlewareHandler } from "hono";

import { getLogRoute } from "../observability/route";
import type { AppHonoEnv } from "../types";

export const requestLogger: MiddlewareHandler<AppHonoEnv> = async (c, next) => {
  const requestId = c.req.header("cf-ray") || crypto.randomUUID();
  const start = Date.now();
  c.set("requestId", requestId);
  c.header("x-request-id", requestId);

  try {
    await next();
  } finally {
    c.header("x-request-id", requestId);

    console.log(
      JSON.stringify({
        requestId,
        method: c.req.method,
        path: getLogRoute(c.req.url),
        status: c.res.status,
        durationMs: Date.now() - start,
      }),
    );
  }
};
