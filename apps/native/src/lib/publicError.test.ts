import { describe, expect, it } from "vitest";

import { publicErrorDetails, resolvePublicError } from "./publicError";

describe("resolvePublicError", () => {
  it("maps tRPC public codes and request ids", () => {
    expect(
      resolvePublicError(
        {
          message: "password=secret",
          data: { appCode: "RATE_LIMITED", requestId: "ray-1" },
        },
        "Fallback",
      ),
    ).toEqual({
      code: "RATE_LIMITED",
      message: "Too many requests. Please try again later.",
      requestId: "ray-1",
    });
  });

  it("uses contextual fallback and ignores hostile messages", () => {
    expect(
      resolvePublicError(
        { message: "SQL password leaked", stack: "private stack" },
        "Could not save the recipe.",
      ),
    ).toEqual({
      code: "UNEXPECTED_ERROR",
      message: "Could not save the recipe.",
    });
  });

  it("maps Better Auth codes without using vendor messages", () => {
    expect(
      resolvePublicError(
        { code: "INVALID_EMAIL_OR_PASSWORD", message: "hostile" },
        "Sign in failed.",
      ).message,
    ).toBe("The email or password is incorrect.");
  });

  it("maps terms acceptance errors to actionable guidance", () => {
    expect(
      resolvePublicError(
        { data: { appCode: "TERMS_ACCEPTANCE_REQUIRED" } },
        "Could not publish this content.",
      ),
    ).toEqual({
      code: "TERMS_ACCEPTANCE_REQUIRED",
      message:
        "Review and accept the current Terms of Service in Settings to continue.",
    });
  });

  it.each([
    [401, "AUTH_REQUIRED"],
    [403, "ACCESS_DENIED"],
    [404, "NOT_FOUND"],
    [409, "CONFLICT"],
    [413, "PAYLOAD_TOO_LARGE"],
    [422, "INVALID_INPUT"],
  ] as const)("maps expected HTTP %s responses to %s", (status, code) => {
    const resolved = resolvePublicError(
      { code: "UNRECOGNIZED_VENDOR_CODE", status },
      "Contextual fallback.",
    );

    expect(resolved.code).toBe(code);
  });

  it("treats unrecognized Better Auth validation codes as invalid input", () => {
    expect(
      resolvePublicError(
        { code: "INVALID_EMAIL", status: 400 },
        "Check your email and try again.",
      ),
    ).toEqual({
      code: "INVALID_INPUT",
      message: "Check your email and try again.",
    });
  });

  it("handles HTTP 429, offline errors, and malformed responses", () => {
    expect(resolvePublicError({ status: 429 }, "Fallback").code).toBe(
      "RATE_LIMITED",
    );
    expect(
      resolvePublicError(new TypeError("Network request failed"), "Fallback")
        .code,
    ).toBe("SERVICE_UNAVAILABLE");
    expect(resolvePublicError(null, "Fallback").message).toBe("Fallback");
    expect(
      resolvePublicError(
        { data: { code: "TOO_MANY_REQUESTS", httpStatus: 429 } },
        "Fallback",
      ).code,
    ).toBe("RATE_LIMITED");
  });

  it("only accepts http source URL details", () => {
    expect(
      publicErrorDetails({
        data: { details: { sourceUrl: "https://example.com/recipe" } },
      }),
    ).toEqual({ sourceUrl: "https://example.com/recipe" });
    expect(
      publicErrorDetails({
        data: { details: { sourceUrl: `${"java"}script:alert(1)` } },
      }),
    ).toEqual({});
  });
});
