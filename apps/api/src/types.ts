import type { TRPCEnv } from "@repo/trpc/server/env";

export type Env = TRPCEnv & {
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: "development" | "production";
};

export type AppHonoEnv = {
  Bindings: Env;
  Variables: {
    requestId: string;
  };
};
