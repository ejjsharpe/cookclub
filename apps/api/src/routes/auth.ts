import { getAuth } from "@repo/auth";
import { getPublicErrorMessage } from "@repo/trpc/server";
import type { Hono } from "hono";

import { getLogRoute } from "../observability/route";
import type { AppHonoEnv } from "../types";

function createMutableRequest(request: Request): Request {
  return new Request(request, {
    headers: new Headers(request.headers),
  });
}

export async function withSafeAuthErrorBody(
  response: Response,
  requestId: string,
): Promise<Response> {
  if (response.status < 400) return response;
  if (!response.headers.get("content-type")?.includes("application/json")) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("x-request-id", requestId);
  headers.delete("content-length");

  if (response.status >= 500) {
    return Response.json(
      {
        code: "SERVICE_UNAVAILABLE",
        message: getPublicErrorMessage("SERVICE_UNAVAILABLE"),
        requestId,
      },
      { status: response.status, headers },
    );
  }

  const body = await response.json().catch(() => ({}));
  const safeBody =
    body && typeof body === "object" ? body : { code: "INVALID_INPUT" };
  return Response.json(
    { ...safeBody, requestId },
    { status: response.status, headers },
  );
}

export function registerAuthRoutes(app: Hono<AppHonoEnv>) {
  app.on(["POST", "GET"], "/auth/*", async (c) => {
    const requestId = c.get("requestId");
    const response = await getAuth(c.env, {
      requestId,
      route: getLogRoute(c.req.url),
      waitUntil: (promise) => c.executionCtx.waitUntil(promise),
    }).handler(createMutableRequest(c.req.raw));
    return withSafeAuthErrorBody(response, requestId);
  });
}
