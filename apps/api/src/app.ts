import { Hono } from "hono";
import { cors } from "hono/cors";

import { enforceApiRateLimit } from "./middleware/rate-limit";
import { requestLogger } from "./middleware/request-logger";
import { registerAdaptyWebhookRoutes } from "./routes/adapty-webhook";
import { registerAuthRoutes } from "./routes/auth";
import { registerHealthRoutes } from "./routes/health";
import { registerTrpcRoutes } from "./routes/trpc";
import type { Env } from "./types";

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
  const app = new Hono<{ Bindings: Env }>();

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

  return app;
}
