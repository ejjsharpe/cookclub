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
          throw new Error(
            `Cerebras failed (${errorMessage(primaryError)}); Groq fallback failed (${errorMessage(secondaryError)}).`,
          );
        }
      }
    },
  };
}
