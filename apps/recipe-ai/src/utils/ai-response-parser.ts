export const DEFAULT_MAX_TOKENS = 8192;

export function extractAiResponsePayload(response: unknown): unknown {
  if (typeof response === "string") return response;
  if (!response || typeof response !== "object") return response;

  const record = response as Record<string, unknown>;
  return record.response ?? record.generated_text ?? record.result ?? response;
}

export async function runAiModel(
  ai: Ai,
  model: string,
  request: Record<string, unknown>,
): Promise<unknown> {
  return await (
    ai as { run: (model: string, request: unknown) => Promise<unknown> }
  ).run(model, request);
}

/**
 * Parse JSON from AI response text, handling potential markdown code blocks
 * or JSON embedded in other text (e.g., from reasoning models).
 */
export function parseAiJsonResponse<T>(response: string): T {
  let jsonStr = response.trim();

  // Remove markdown code blocks if present
  if (jsonStr.startsWith("```json")) {
    jsonStr = jsonStr.slice(7);
  } else if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.slice(3);
  }

  if (jsonStr.endsWith("```")) {
    jsonStr = jsonStr.slice(0, -3);
  }

  jsonStr = jsonStr.trim();

  // Try direct parse first
  try {
    return JSON.parse(jsonStr);
  } catch {
    // Try to find the last complete JSON object (reasoning models often output JSON at the end)
    // Look for JSON starting with { "suggestions" or { "ingredients" etc.
    const jsonPatterns = [
      /\{\s*"suggestions"\s*:\s*\[[\s\S]*\]\s*\}/,
      /\{\s*"ingredients"\s*:\s*\[[\s\S]*\]\s*\}/,
      /\{\s*"name"\s*:[\s\S]*\}/,
    ];

    for (const pattern of jsonPatterns) {
      const match = jsonStr.match(pattern);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch {
          // Continue to next pattern
        }
      }
    }

    // Last resort: find any JSON object
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        // Fall through to error
      }
    }

    throw new Error(
      `Failed to parse AI response as JSON: ${jsonStr.slice(0, 500)}`,
    );
  }
}

export function parseAiJsonPayload<T>(
  response: unknown,
  emptyMessage = "Invalid AI response format",
): T {
  const payload = extractAiResponsePayload(response);

  if (!payload) {
    throw new Error(emptyMessage);
  }

  if (typeof payload !== "string") {
    return payload as T;
  }

  return parseAiJsonResponse<T>(payload);
}
