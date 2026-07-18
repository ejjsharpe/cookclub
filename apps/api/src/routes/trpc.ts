import { trpcServer } from "@hono/trpc-server";
import {
  appRouter,
  createContext,
  publicErrorForResponse,
} from "@repo/trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import type { Hono } from "hono";

import { captureApiException } from "../observability/sentry";
import type { AppHonoEnv } from "../types";

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

export function registerTrpcRoutes(app: Hono<AppHonoEnv>) {
  app.use(
    "/trpc/*",
    trpcServer({
      router: appRouter,
      endpoint: "/trpc",
      createContext: (opts, c) => {
        return createContext(opts, c.env, c.executionCtx, c.get("requestId"));
      },
      onError({ error, path, ctx }) {
        const errorRequestId =
          "requestId" in error && typeof error.requestId === "string"
            ? error.requestId
            : undefined;
        const status = getHTTPStatusCodeFromError(error);
        const publicCode = publicErrorForResponse(error, status).appCode;
        const log = {
          requestId: ctx?.requestId ?? errorRequestId ?? "unknown",
          procedure: path ?? "unknown",
          status,
          publicCode,
          ...(status >= 500 && { errorStack: privateErrorStack(error) }),
        };
        if (status >= 500) {
          captureApiException(error, {
            operation: "trpc",
            requestId: log.requestId,
            procedure: path ?? "unknown",
            status,
            userId: ctx?.user?.id,
          });
          console.error(JSON.stringify(log));
        } else {
          console.warn(JSON.stringify(log));
        }
      },
    }),
  );
}
