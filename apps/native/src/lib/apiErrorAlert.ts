import * as Sentry from "@sentry/react-native";
import { Alert } from "react-native";

import { resolvePublicError } from "./publicError";

export function reportApiError(
  error: unknown,
  options: { operation: string; fallback: string },
) {
  const resolved = resolvePublicError(error, options.fallback);
  if (
    resolved.code !== "SERVICE_UNAVAILABLE" &&
    resolved.code !== "UNEXPECTED_ERROR"
  ) {
    return resolved;
  }

  Sentry.withScope((scope) => {
    scope.setTag("operation", options.operation);
    if (resolved.requestId) {
      scope.setTag("request_id", resolved.requestId);
    }
    Sentry.captureException(
      error instanceof Error ? error : new Error(`API ${resolved.code}`),
    );
  });
  return resolved;
}

export function alertApiError(
  title: string,
  error: unknown,
  options: { operation: string; fallback: string },
) {
  const resolved = reportApiError(error, options);
  Alert.alert(title, resolved.message);
  return resolved;
}
