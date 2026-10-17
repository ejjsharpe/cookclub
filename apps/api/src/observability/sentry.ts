import type { RecipeImportFailureEvent } from "@repo/trpc/server";
import * as Sentry from "@sentry/hono/cloudflare";
import type { CloudflareOptions, Event } from "@sentry/hono/cloudflare";

import type { Env } from "../types";
import { getLogRoute } from "./route";

type ErrorContext = {
  operation: string;
  requestId?: string;
  procedure?: string;
  route?: string;
  status?: number;
  userId?: string;
};

type QueueErrorContext = {
  queue: string;
  messageId: string;
  attempts: number;
  terminal: boolean;
  jobId: string;
  userId: string;
};

const SAFE_REQUEST_HEADERS = new Set(["cf-ray", "content-type", "user-agent"]);

function requestUrlWithoutQuery(url: string | undefined) {
  if (!url) return url;

  try {
    const parsed = new URL(url);
    return `${parsed.origin}${getLogRoute(url)}`;
  } catch {
    return undefined;
  }
}

export function redactSentryEvent<T extends Event>(event: T): T {
  // The SDK also copies raw URLs into root and child span attributes.
  for (const data of [
    event.contexts?.trace?.data,
    ...(event.spans?.map((span) => span.data) ?? []),
  ]) {
    if (!data) continue;
    delete data["url.full"];
    delete data["url.path"];
    delete data["url.query"];
    delete data["url.fragment"];
    delete data["http.url"];
  }

  if (!event.request) return event;

  const safeHeaders = Object.fromEntries(
    Object.entries(event.request.headers ?? {}).filter(([name]) =>
      SAFE_REQUEST_HEADERS.has(name.toLowerCase()),
    ),
  );

  event.request = {
    url: requestUrlWithoutQuery(event.request.url),
    method: event.request.method,
    headers: safeHeaders,
  };

  return event;
}

export function getSentryOptions(env: Env): CloudflareOptions {
  return {
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? "development",
    sendDefaultPii: false,
    tracesSampleRate: env.SENTRY_ENVIRONMENT === "production" ? 0.05 : 0,
    beforeSend: redactSentryEvent,
    beforeSendTransaction: redactSentryEvent,
  };
}

export function captureApiException(error: unknown, context: ErrorContext) {
  Sentry.withScope((scope) => {
    scope.setTag("operation", context.operation);
    if (context.procedure) scope.setTag("procedure", context.procedure);
    if (context.route) scope.setTag("route", context.route);
    if (context.status) scope.setTag("http.status_code", context.status);
    if (context.userId) scope.setUser({ id: context.userId });
    scope.setContext("cookclub", {
      requestId: context.requestId,
    });
    Sentry.captureException(error);
  });
}

export function captureQueueException(
  error: unknown,
  context: QueueErrorContext,
) {
  Sentry.withScope((scope) => {
    scope.setTag("operation", "recipe-import");
    scope.setTag("queue", context.queue);
    scope.setTag("attempt", context.attempts);
    scope.setTag("terminal", context.terminal);
    scope.setUser({ id: context.userId });
    scope.setContext("recipe_import", {
      jobId: context.jobId,
      messageId: context.messageId,
      attempts: context.attempts,
      terminal: context.terminal,
    });
    Sentry.captureException(error);
  });
}

export function shouldCaptureImportFailure(failure: RecipeImportFailureEvent) {
  return (
    failure.event === "recipe_import_retry_exhausted" ||
    failure.errorCode === "IMPORT_SOURCE_UNAVAILABLE" ||
    failure.errorCode === "IMPORT_RECIPE_NOT_FOUND" ||
    failure.errorCode === "IMPORT_FAILED"
  );
}

export function captureImportFailure(
  failure: RecipeImportFailureEvent,
  queue: string,
) {
  if (!shouldCaptureImportFailure(failure)) return;

  Sentry.withScope((scope) => {
    scope.setLevel(
      failure.event === "recipe_import_retry_exhausted" ||
        failure.errorCode === "IMPORT_FAILED"
        ? "error"
        : "warning",
    );
    scope.setFingerprint([
      "recipe-import",
      failure.errorCode ?? "unknown",
      failure.mode ?? "unknown",
      failure.sourceHost ?? "no-source-host",
    ]);
    scope.setTags({
      operation: "recipe-import",
      queue,
      import_type: failure.importType ?? "unknown",
      import_mode: failure.mode ?? "unknown",
      import_error_code: failure.errorCode,
      import_event: failure.event,
      source_host: failure.sourceHost ?? "none",
    });
    scope.setUser({ id: failure.userId });
    scope.setContext("recipe_import", {
      jobId: failure.jobId,
      event: failure.event,
      retryAfterSeconds: failure.retryAfterSeconds,
      sourceHost: failure.sourceHost,
      sourceUrl: failure.sourceUrl,
    });
    Sentry.captureMessage("Recipe import failed");
  });
}
