import { getPublicErrorMessage } from "@repo/trpc/server";
import { sentry } from "@sentry/hono/cloudflare";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { enforceApiRateLimit } from "./middleware/rate-limit";
import { requestLogger } from "./middleware/request-logger";
import { getLogRoute } from "./observability/route";
import { getSentryOptions } from "./observability/sentry";
import { registerAdaptyWebhookRoutes } from "./routes/adapty-webhook";
import { registerAuthRoutes } from "./routes/auth";
import { registerHealthRoutes } from "./routes/health";
import { registerTrpcRoutes } from "./routes/trpc";
import type { AppHonoEnv, Env } from "./types";

function privateErrorStack(error: unknown): string {
  const stacks: string[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current instanceof Error && !seen.has(current) && stacks.length < 5) {
    seen.add(current);
    stacks.push(current.stack ?? current.name);
    current = current.cause;
  }
  return stacks.join("\nCaused by: ");
}

function getCorsOrigins(env: Env): Set<string> {
  const configured =
    env.TRUSTED_ORIGINS?.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean) ?? [];

  return new Set([
    "https://cookclub.app",
    "https://www.cookclub.app",
    "https://api.cookclub.app",
    "https://admin.cookclub.app",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:4321",
    "http://127.0.0.1:4321",
    env.BETTER_AUTH_URL,
    ...configured,
  ]);
}

const credentialedCors = cors({
  origin: (origin, c) => (getCorsOrigins(c.env).has(origin) ? origin : null),
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["content-type", "authorization", "x-trpc-source"],
  exposeHeaders: ["x-request-id"],
  credentials: true,
  maxAge: 600,
});

export function createApp() {
  const app = new Hono<AppHonoEnv>();

  app.use(sentry(app, getSentryOptions));
  app.use("*", requestLogger);
  app.use("/auth/*", credentialedCors);
  app.use("/trpc/*", credentialedCors);

  app.use("/api/*", enforceApiRateLimit);
  app.use("/auth/*", enforceApiRateLimit);
  app.use("/trpc/*", enforceApiRateLimit);

  registerAuthRoutes(app);
  registerAdaptyWebhookRoutes(app);
  registerTrpcRoutes(app);
  registerHealthRoutes(app);

  app.onError((error, c) => {
    const requestId = c.get("requestId") || crypto.randomUUID();
    console.error(
      JSON.stringify({
        requestId,
        route: getLogRoute(c.req.url),
        status: 500,
        publicCode: "UNEXPECTED_ERROR",
        errorStack: privateErrorStack(error),
      }),
    );
    c.header("x-request-id", requestId);
    return c.json(
      {
        code: "UNEXPECTED_ERROR",
        message: getPublicErrorMessage("UNEXPECTED_ERROR"),
        requestId,
      },
      500,
    );
  });

  return app;
}
