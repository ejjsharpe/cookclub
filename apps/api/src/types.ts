import type { TRPCEnv } from "@repo/trpc/server/env";

type ConfiguredTRPCEnv = Pick<Cloudflare.Env, keyof TRPCEnv>;

/**
 * Wrangler owns the complete binding list. TRPCEnv narrows the configured
 * bindings that shared routers use to their domain-specific RPC/queue types.
 */
export type Env = Omit<Cloudflare.Env, keyof ConfiguredTRPCEnv> & TRPCEnv;

export type AppHonoEnv = {
  Bindings: Env;
  Variables: {
    requestId: string;
  };
};
