import type { Env, ParseResult } from "../types";
import { parseRecipeFromText } from "./ai-client";
import { aiResultToRecipe } from "./recipe-mapper";
import { acceptedCandidate } from "./url-parse-utils";
import { extractRecipeOutline } from "../utils/recipe-outline-parser";

/**
 * Parse a recipe from free-form text
 */
export async function parseText(env: Env, text: string): Promise<ParseResult> {
  // Validate input
  if (!text || text.trim().length < 50) {
    return {
      success: false,
      error: {
        code: "INVALID_INPUT",
        message: "Text must be at least 50 characters",
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
    };
  }

  try {
    const outlineRecipe = extractRecipeOutline(text, {
      sourceUrl: null,
      sourceType: "text",
    });
    const outlineResult = await acceptedCandidate(
      env,
      "text",
      outlineRecipe,
      "ai",
      {
        parseMethod: "outline_rules",
        cache: false,
        metadataSource: "text",
      },
    );
    if (outlineResult) return outlineResult;

    const aiResult = await parseRecipeFromText(env.AI, text.trim());
    const recipe = aiResultToRecipe(aiResult, {
      sourceType: "text",
      sourceUrl: null,
    });
    const result = await acceptedCandidate(env, "text", recipe, "ai", {
      parseMethod: "ai_only",
      cache: false,
      metadataSource: "text",
    });
    if (result) return result;

    return {
      success: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "AI output did not match expected schema",
      },
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: "AI_PARSE_FAILED",
        message: error instanceof Error ? error.message : "AI parsing failed",
      },
    };
  }
}
