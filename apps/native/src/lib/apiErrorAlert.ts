import { LEGAL_URLS } from "@repo/contracts";
import * as Sentry from "@sentry/react-native";
import { Alert } from "react-native";

import { openExternalWebsite } from "./externalBrowser";
import { resolvePublicError } from "./publicError";

import { navigationRef } from "@/navigation/navigationRef";

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
  if (resolved.code === "TERMS_ACCEPTANCE_REQUIRED") {
    Alert.alert("Terms acceptance required", resolved.message, [
      { text: "Not Now", style: "cancel" },
      {
        text: "Read Terms",
        onPress: () => {
          return openExternalWebsite(LEGAL_URLS.terms);
        },
      },
      {
        text: "Open Settings",
        onPress: () => {
          if (navigationRef.isReady()) navigationRef.navigate("Settings");
        },
      },
    ]);
    return resolved;
  }
  Alert.alert(title, resolved.message);
  return resolved;
}
