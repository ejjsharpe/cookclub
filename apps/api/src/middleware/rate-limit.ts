import { getPublicErrorMessage } from "@repo/trpc/server";
import type { MiddlewareHandler } from "hono";

import type { AppHonoEnv } from "../types";

export const enforceApiRateLimit: MiddlewareHandler<AppHonoEnv> = async (
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
    return c.json(
      {
        code: "RATE_LIMITED",
        message: getPublicErrorMessage("RATE_LIMITED"),
        requestId: c.get("requestId"),
      },
      429,
    );
  }

  return next();
};
