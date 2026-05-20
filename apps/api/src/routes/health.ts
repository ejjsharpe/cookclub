import type { Hono } from "hono";

import type { Env } from "../types";

export function registerHealthRoutes(app: Hono<{ Bindings: Env }>) {
  app.get("/health", (c) => c.json({ status: "ok" }));
}
