import type { TRPCEnv } from "@repo/trpc/server/env";

export type Env = TRPCEnv;

export type AppHonoEnv = {
  Bindings: Env;
  Variables: {
    requestId: string;
  };
};
