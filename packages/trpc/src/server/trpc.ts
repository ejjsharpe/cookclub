import { initTRPC, TRPCError } from "@trpc/server";

import type { Context } from "./context";
import { getPublicErrorMessage, publicErrorForResponse } from "./public-errors";

const t = initTRPC.context<Context>().create({
  isDev: false,
  errorFormatter({ shape, error, ctx }) {
    const publicError = publicErrorForResponse(error, shape.data.httpStatus);
    const errorRequestId =
      "requestId" in error && typeof error.requestId === "string"
        ? error.requestId
        : undefined;
    return {
      message: publicError.message,
      code: shape.code,
      data: {
        code: shape.data.code,
        httpStatus: shape.data.httpStatus,
        appCode: publicError.appCode,
        requestId: ctx?.requestId ?? errorRequestId ?? "unknown",
        ...(publicError.details && { details: publicError.details }),
      },
    };
  },
});

export const router = t.router;
export const mergeRouters = t.mergeRouters;
export const publicProcedure = t.procedure;

export const authedProcedure = t.procedure.use(async function isAuthed(opts) {
  const { ctx } = opts;

  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: getPublicErrorMessage("AUTH_REQUIRED"),
    });
  }

  return opts.next({ ...opts, ctx: { ...ctx, user: ctx.user } });
});
