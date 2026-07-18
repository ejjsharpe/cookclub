import type { Hono } from "hono";

import type { AppHonoEnv } from "../types";

export function registerHealthRoutes(app: Hono<AppHonoEnv>) {
  app.get("/health", (c) => c.json({ status: "ok" }));
}
