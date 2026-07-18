import { getAuth } from "@repo/auth";
import { getDb } from "@repo/db";
import { TRPCError } from "@trpc/server";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";

import type { TRPCEnv } from "./env";

export async function createContext(
  opts: FetchCreateContextFnOptions,
  env: TRPCEnv,
  executionCtx?: { waitUntil(promise: Promise<unknown>): void },
  requestId = reqRequestId(opts.req),
) {
  try {
    const { req, resHeaders } = opts;
    const db = getDb(env);
    const auth = getAuth(env, { requestId });
    const session = await auth.api.getSession({ headers: req.headers });
    const user = session?.user ?? null;
    const waitUntil = (promise: Promise<unknown>) => {
      executionCtx?.waitUntil(promise);
    };

    return { req, resHeaders, env, db, user, waitUntil, requestId };
  } catch (cause) {
    const error = new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause });
    Object.assign(error, { requestId });
    throw error;
  }
}

function reqRequestId(req: Request): string {
  return (
    req.headers.get("x-request-id") ?? req.headers.get("cf-ray") ?? "unknown"
  );
}

export type Context = Awaited<ReturnType<typeof createContext>>;
