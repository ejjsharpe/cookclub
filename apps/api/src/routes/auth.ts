import { getAuth } from "@repo/auth";
import type { Hono } from "hono";

import type { Env } from "../types";

function createMutableRequest(request: Request): Request {
  return new Request(request, {
    headers: new Headers(request.headers),
  });
}

export function registerAuthRoutes(app: Hono<{ Bindings: Env }>) {
  app.on(["POST", "GET"], "/auth/*", async (c) => {
    return getAuth(c.env).handler(createMutableRequest(c.req.raw));
  });
}
