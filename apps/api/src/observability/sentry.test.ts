import { describe, expect, it } from "vitest";

import {
  getSentryOptions,
  redactSentryEvent,
  shouldCaptureImportFailure,
} from "./sentry";

describe("Sentry observability", () => {
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

  it.each([
    ["IMPORT_SOURCE_UNAVAILABLE", true],
    ["IMPORT_RECIPE_NOT_FOUND", true],
    ["IMPORT_FAILED", true],
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
