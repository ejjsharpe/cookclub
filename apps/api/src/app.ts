import { Hono } from "hono";

import { enforceApiRateLimit } from "./middleware/rate-limit";
import { requestLogger } from "./middleware/request-logger";
import { registerAdaptyWebhookRoutes } from "./routes/adapty-webhook";
import { registerAuthRoutes } from "./routes/auth";
import { registerHealthRoutes } from "./routes/health";
import { registerTrpcRoutes } from "./routes/trpc";
import type { Env } from "./types";

export function createApp() {
  const app = new Hono<{ Bindings: Env }>();

  app.use("*", requestLogger);

  app.use("/api/*", enforceApiRateLimit);
  app.use("/auth/*", enforceApiRateLimit);
  app.use("/trpc/*", enforceApiRateLimit);

  registerAuthRoutes(app);
  registerAdaptyWebhookRoutes(app);
  registerTrpcRoutes(app);
  registerHealthRoutes(app);

  return app;
}
