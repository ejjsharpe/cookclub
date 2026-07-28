import {
  ProviderRequestError,
  providerTransportError,
} from "./provider-response";
import type { AiClient } from "../utils/ai-response-parser";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown AI provider error";
}

/**
 * Use the secondary provider only when the primary provider cannot complete a
 * request. Each provider maps the workload to its own model.
 */
export function createFallbackAiClient(
  primary: AiClient,
  secondary: AiClient,
): AiClient {
  return {
    async complete(workload, request) {
      try {
        return await primary.complete(workload, request);
      } catch (primaryError) {
        console.warn(
          JSON.stringify({
            event: "ai_provider_fallback",
            workload,
            primary: "cerebras",
            secondary: "groq",
            error: errorMessage(primaryError),
          }),
        );

        try {
          return await secondary.complete(workload, request);
        } catch (secondaryError) {
          const primaryFailure = providerTransportError(
            primaryError,
            "Cerebras",
          );
          const secondaryFailure = providerTransportError(
            secondaryError,
            "Groq",
          );
          throw new ProviderRequestError(
            `Cerebras failed (${errorMessage(primaryFailure)}); Groq fallback failed (${errorMessage(secondaryFailure)}).`,
            {
              provider: "Cerebras+Groq",
              status: secondaryFailure.status ?? primaryFailure.status,
              retryAfterSeconds:
                secondaryFailure.retryAfterSeconds ??
                primaryFailure.retryAfterSeconds,
              requestId: secondaryFailure.requestId ?? primaryFailure.requestId,
              retryable: primaryFailure.retryable || secondaryFailure.retryable,
              timedOut: primaryFailure.timedOut || secondaryFailure.timedOut,
              cause: { primary: primaryFailure, secondary: secondaryFailure },
            },
          );
        }
      }
    },
  };
}
