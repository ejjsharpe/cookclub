import type { MiddlewareHandler } from "hono";

import type { Env } from "../types";

export const enforceApiRateLimit: MiddlewareHandler<{ Bindings: Env }> = async (
  c,
  next,
) => {
  if (!c.env.API_RATE_LIMITER) {
    return next();
  }

  const ip =
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-forwarded-for") ||
    "unknown";
  const outcome = await c.env.API_RATE_LIMITER.limit({ key: `ip:${ip}` });

  if (!outcome.success) {
    return c.json({ error: "Too many requests" }, 429);
  }

  return next();
};
