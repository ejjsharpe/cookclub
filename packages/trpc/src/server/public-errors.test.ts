import { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { describe, expect, it } from "vitest";

import {
  getPublicErrorMessage,
  PublicTRPCError,
  publicCodeForTransport,
  publicErrorForResponse,
} from "./public-errors";
import { publicProcedure, router } from "./trpc";

describe("public tRPC errors", () => {
  it("replaces arbitrary internal messages with canonical copy", () => {
    const error = new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "password=secret relation recipe_import_jobs does not exist",
      cause: new Error("provider token and storage/temp/private-key"),
    });

    const result = publicErrorForResponse(error, 500);
    expect(result).toEqual({
      appCode: "UNEXPECTED_ERROR",
      message: getPublicErrorMessage("UNEXPECTED_ERROR"),
    });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("provider");
    expect(JSON.stringify(result)).not.toContain("storage/temp");
  });

  it("preserves marked public copy and allow-listed details", () => {
    const error = new PublicTRPCError({
      code: "FORBIDDEN",
      appCode: "EXTERNAL_RECIPE_SOURCE",
      details: { sourceUrl: "https://example.com/recipe" },
    });

    expect(publicErrorForResponse(error, 403)).toEqual({
      appCode: "EXTERNAL_RECIPE_SOURCE",
      message: getPublicErrorMessage("EXTERNAL_RECIPE_SOURCE"),
      details: { sourceUrl: "https://example.com/recipe" },
    });
  });

  it("preserves explicitly marked safe validation copy", () => {
    const error = new PublicTRPCError({
      code: "BAD_REQUEST",
      appCode: "INVALID_INPUT",
      message: "You cannot delete your own admin account.",
    });

    expect(publicErrorForResponse(error, 400)).toEqual({
      appCode: "INVALID_INPUT",
      message: "You cannot delete your own admin account.",
    });
  });

  it("drops unsafe source URLs", () => {
    const error = new PublicTRPCError({
      code: "FORBIDDEN",
      appCode: "EXTERNAL_RECIPE_SOURCE",
      details: { sourceUrl: `${"java"}script:alert(1)` },
    });
    expect(publicErrorForResponse(error, 403)).not.toHaveProperty("details");
  });

  it("maps validation, rate limit, and upstream statuses", () => {
    expect(publicCodeForTransport("BAD_REQUEST", 400)).toBe("INVALID_INPUT");
    expect(publicCodeForTransport("TOO_MANY_REQUESTS", 429)).toBe(
      "RATE_LIMITED",
    );
    expect(publicCodeForTransport("BAD_GATEWAY", 502)).toBe(
      "SERVICE_UNAVAILABLE",
    );
    expect(publicCodeForTransport("GATEWAY_TIMEOUT", 504)).toBe(
      "SERVICE_UNAVAILABLE",
    );
  });

  it("serializes only the safe response contract", async () => {
    const unsafeRouter = router({
      unsafe: publicProcedure.query(() => {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "relation users password=secret",
          cause: new Error("provider response and storage key"),
        });
      }),
    });
    const response = await fetchRequestHandler({
      endpoint: "/trpc",
      req: new Request("https://api.example.com/trpc/unsafe"),
      router: unsafeRouter,
      createContext: () => ({ requestId: "request-123" }) as any,
    });
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(body).toMatchObject({
      error: {
        message: getPublicErrorMessage("UNEXPECTED_ERROR"),
        data: {
          code: "INTERNAL_SERVER_ERROR",
          httpStatus: 500,
          appCode: "UNEXPECTED_ERROR",
          requestId: "request-123",
        },
      },
    });
    for (const privateValue of [
      "relation users",
      "password=secret",
      "provider response",
      "storage key",
      "stack",
      "path",
      "cause",
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });
});
