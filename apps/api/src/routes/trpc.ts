import { trpcServer } from "@hono/trpc-server";
import { appRouter, createContext } from "@repo/trpc/server";
import type { Hono } from "hono";

import type { Env } from "../types";

export function registerTrpcRoutes(app: Hono<{ Bindings: Env }>) {
  app.use(
    "/trpc/*",
    trpcServer({
      router: appRouter,
      endpoint: "/trpc",
      createContext: (opts, c) => {
        return createContext(opts, c.env, c.executionCtx);
      },
    }),
  );
}
