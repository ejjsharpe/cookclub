import * as Sentry from "@sentry/hono/cloudflare";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  captureImportFailure,
  getSentryOptions,
  redactSentryEvent,
  shouldCaptureImportFailure,
} from "./sentry";

vi.mock("@sentry/hono/cloudflare", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sentry/hono/cloudflare")>()),
  captureMessage: vi.fn(),
}));

describe("Sentry observability", () => {
  afterEach(() => vi.clearAllMocks());

  it("includes the full recipe URL in captured context and preserves it through redaction", () => {
    const sourceUrl = "https://example.com/cookbook/recipes/ragu?servings=2";
    let capturedEvent: Sentry.Event | undefined;
    vi.mocked(Sentry.captureMessage).mockImplementation(() => {
      const scope = Sentry.getCurrentScope().getScopeData();
      capturedEvent = redactSentryEvent({
        contexts: scope.contexts,
        tags: scope.tags,
        fingerprint: scope.fingerprint,
        request: {
          url: "https://api.cookclub.app/trpc/recipe.import?token=secret",
          data: { private: "request data" },
        },
      });
      return "event-id";
    });

    captureImportFailure(
      {
        event: "recipe_import_terminal_failure",
        jobId: "job-1",
        userId: "user-1",
        importType: "basic",
        mode: "url",
        errorCode: "IMPORT_RECIPE_NOT_FOUND",
        sourceHost: "example.com",
        sourceUrl,
      },
      "recipe-import-basic",
    );

    expect(Sentry.captureMessage).toHaveBeenCalledWith("Recipe import failed");
    expect(capturedEvent).toMatchObject({
      contexts: { recipe_import: { sourceHost: "example.com", sourceUrl } },
      tags: { source_host: "example.com" },
      fingerprint: [
        "recipe-import",
        "IMPORT_RECIPE_NOT_FOUND",
        "url",
        "example.com",
      ],
      request: { url: "https://api.cookclub.app/trpc/recipe.import" },
    });
    expect(capturedEvent?.request).not.toHaveProperty("data");
  });

  it("removes request bodies, query strings, cookies, and sensitive headers", () => {
    const event = redactSentryEvent({
      type: undefined,
      request: {
        url: "https://api.cookclub.app/trpc/recipe.import?token=secret",
        method: "POST",
        data: { recipeUrl: "https://example.com/private-recipe" },
        cookies: { session: "secret" },
        headers: {
          authorization: "Bearer secret",
          cookie: "session=secret",
          "cf-ray": "request-1",
          "content-type": "application/json",
        },
      },
    });

    expect(event.request).toEqual({
      url: "https://api.cookclub.app/trpc/recipe.import",
      method: "POST",
      headers: {
        "cf-ray": "request-1",
        "content-type": "application/json",
      },
    });
  });

  it("captures image provider failures with the original provider diagnostics", () => {
    const message =
      "Cerebras failed (Cerebras request failed with status 404: model_archived); Groq fallback failed (Groq request failed with status 404: model_not_found).";
    let capturedScope: unknown;
    vi.mocked(Sentry.captureMessage).mockImplementation(() => {
      capturedScope = Sentry.getCurrentScope().getScopeData();
      return "event-id";
    });

    captureImportFailure(
      {
        event: "recipe_import_terminal_failure",
        jobId: "job-image",
        userId: "user-1",
        importType: "smart",
        mode: "image",
        errorCode: "SERVICE_UNAVAILABLE",
        message,
      },
      "recipe-import-image",
    );

    expect(Sentry.captureMessage).toHaveBeenCalledOnce();
    expect(capturedScope).toMatchObject({
      level: "error",
      tags: { import_mode: "image", import_error_code: "SERVICE_UNAVAILABLE" },
      contexts: { recipe_import: { jobId: "job-image", message } },
    });
  });

  it("samples production traces without enabling default PII", () => {
    expect(
      getSentryOptions({
        SENTRY_DSN: "https://public@example.ingest.sentry.io/1",
        SENTRY_ENVIRONMENT: "production",
      } as any),
    ).toMatchObject({
      dsn: "https://public@example.ingest.sentry.io/1",
      environment: "production",
      sendDefaultPii: false,
      tracesSampleRate: 0.05,
    });
  });

  it.each([true, false])(
    "removes reset tokens from root and child spans (request present: %s)",
    (hasRequest) => {
      const url =
        "https://api.cookclub.app/auth/reset-password/secret-token?token=secret-query";
      const attributes = {
        "url.full": url,
        "url.path": "/auth/reset-password/secret-token",
        "url.query": "?token=secret-query",
        "url.fragment": "token=secret-fragment",
        "http.url": url,
        "http.request.method": "GET",
        "http.route": "/auth/*",
      };
      const event = redactSentryEvent({
        type: "transaction",
        transaction: "GET /auth/*",
        request: hasRequest ? { url } : undefined,
        contexts: {
          trace: {
            span_id: "fedcba9876543210",
            trace_id: "0123456789abcdef0123456789abcdef",
            data: { ...attributes },
          },
        },
        spans: [
          {
            span_id: "0123456789abcdef",
            trace_id: "0123456789abcdef0123456789abcdef",
            start_timestamp: 1,
            data: { ...attributes },
          },
        ],
      });

      expect(JSON.stringify(event)).not.toContain("secret-");
      expect(event.request?.url).toBe(
        hasRequest
          ? "https://api.cookclub.app/auth/reset-password/:token"
          : undefined,
      );
      expect(event.contexts.trace.data).toEqual({
        "http.request.method": "GET",
        "http.route": "/auth/*",
      });
      expect(event.spans[0]!.data).toEqual(event.contexts.trace.data);
    },
  );

  it.each([
    ["IMPORT_SOURCE_UNAVAILABLE", true],
    ["IMPORT_RECIPE_NOT_FOUND", true],
    ["IMPORT_FAILED", true],
    ["SERVICE_UNAVAILABLE", true],
    ["IMPORT_TIMED_OUT", true],
    ["IMPORT_INVALID_URL", false],
    ["IMPORT_IMAGE_INVALID", false],
    ["PAYLOAD_TOO_LARGE", false],
  ] as const)("classifies %s reporting as %s", (errorCode, expected) => {
    expect(
      shouldCaptureImportFailure({
        jobId: "job-1",
        userId: "user-1",
        importType: "smart",
        mode: "url",
        errorCode,
        event: "recipe_import_terminal_failure",
      }),
    ).toBe(expected);
  });
});
