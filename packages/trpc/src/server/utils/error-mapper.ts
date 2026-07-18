import { ServiceError } from "@repo/db/services";
import { TRPCError } from "@trpc/server";

import { PublicTRPCError } from "../public-errors";

/**
 * Convert ServiceError to TRPCError for transport.
 * Maps service-layer errors to tRPC-compatible errors with appropriate codes.
 */
export function mapServiceError(err: unknown): TRPCError {
  if (err instanceof ServiceError) {
    if (err.code !== "INTERNAL_ERROR") {
      const appCode =
        err.code === "FORBIDDEN" && err.details?.sourceUrl
          ? "EXTERNAL_RECIPE_SOURCE"
          : err.code === "FORBIDDEN"
            ? "ACCESS_DENIED"
            : err.code === "BAD_REQUEST"
              ? "INVALID_INPUT"
              : err.code;
      return new PublicTRPCError({
        code: err.code,
        appCode,
        message: err.message,
        ...(err.details && { details: err.details }),
      });
    }
    return new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      cause: err.cause ?? err,
    });
  }
  if (err instanceof TRPCError) {
    return err;
  }
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    cause: err,
  });
}
