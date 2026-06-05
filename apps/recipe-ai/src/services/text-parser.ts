import type { Env, ParseResult } from "../types";
import { parseRecipeFromText } from "./ai-client";
import { aiResultToRecipe } from "./recipe-mapper";
import { acceptedCandidate } from "./url-parse-utils";
import {
  appendFallbackPath,
  recordDiagnosticsStage,
} from "../utils/parse-diagnostics";
import { extractRecipeOutline } from "../utils/recipe-outline-parser";

/**
 * Parse a recipe from free-form text
 */
export async function parseText(env: Env, text: string): Promise<ParseResult> {
  let diagnostics = {};

  // Validate input
  if (!text || text.trim().length < 50) {
    return {
      success: false,
      error: {
        code: "INVALID_INPUT",
        message: "Text must be at least 50 characters",
      },
      metadata: {
        source: "text",
        confidence: "low",
        diagnostics: recordDiagnosticsStage(
          diagnostics,
          "deterministic_parse",
          Date.now(),
          "skipped",
          "input_too_short",
        ),
      },
    };
  }

  if (text.length > 10000) {
    return {
      success: false,
      error: {
        code: "INPUT_TOO_LONG",
        message: "Text must be under 10,000 characters",
      },
      metadata: {
        source: "text",
        confidence: "low",
        diagnostics: recordDiagnosticsStage(
          diagnostics,
          "deterministic_parse",
          Date.now(),
          "skipped",
          "input_too_long",
        ),
      },
    };
  }

  try {
    const deterministicStart = Date.now();
    const outlineRecipe = extractRecipeOutline(text, {
      sourceUrl: null,
      sourceType: "text",
    });
    diagnostics = recordDiagnosticsStage(
      diagnostics,
      "deterministic_parse",
      deterministicStart,
    );
    const outlineResult = await acceptedCandidate(
      env,
      "text",
      outlineRecipe,
      "ai",
      {
        parseMethod: "outline_rules",
        cache: false,
        metadataSource: "text",
        diagnostics,
      },
    );
    if (outlineResult) return outlineResult;

    const aiStart = Date.now();
    const aiResult = await parseRecipeFromText(env.AI, text.trim());
    const recipe = aiResultToRecipe(aiResult, {
      sourceType: "text",
      sourceUrl: null,
    });
    diagnostics = recordDiagnosticsStage(
      appendFallbackPath(diagnostics, "ai"),
      "ai",
      aiStart,
    );
    const result = await acceptedCandidate(env, "text", recipe, "ai", {
      parseMethod: "ai_only",
      cache: false,
      metadataSource: "text",
      diagnostics,
    });
    if (result) return result;

    return {
      success: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "AI output did not match expected schema",
      },
      metadata: {
        source: "text",
        confidence: "low",
        diagnostics,
      },
    };
  } catch (error) {
    diagnostics = recordDiagnosticsStage(
      appendFallbackPath(diagnostics, "ai"),
      "ai",
      Date.now(),
      "error",
      error instanceof Error ? error.message : "ai_parse_failed",
    );
    return {
      success: false,
      error: {
        code: "AI_PARSE_FAILED",
        message: error instanceof Error ? error.message : "AI parsing failed",
      },
      metadata: {
        source: "text",
        confidence: "low",
        diagnostics,
      },
    };
  }
}
