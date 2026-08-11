import { Buffer } from "node:buffer";

import {
  parseRecipeFromImage,
  parseRecipeFromImages,
} from "../services/ai-client";
import { providerFailureFields } from "../services/provider-response";
import { aiResultToRecipe } from "../services/recipe-mapper";
import type { Env, ParseResult } from "../types";
import { acceptedCandidate } from "./url/parse";
import type { AiClient } from "../utils/ai-response-parser";
import {
  appendFallbackPath,
  recordDiagnosticsStage,
} from "../utils/parse-diagnostics";

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const VALID_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

export interface RecipeSourceImage {
  imageData: ArrayBuffer;
  mimeType: string;
  sourceImageUrl: string;
}

/**
 * Parse a recipe from an image
 */
export async function parseImage(
  env: Env,
  imageData: ArrayBuffer,
  mimeType: string,
  sourceImageUrl: string,
  ai: AiClient,
): Promise<ParseResult> {
  return await parseImages(env, [{ imageData, mimeType, sourceImageUrl }], ai);
}

/** Parse a single recipe that may span several selected photos or pages. */
export async function parseImages(
  env: Env,
  images: RecipeSourceImage[],
  ai: AiClient,
): Promise<ParseResult> {
  let diagnostics = {};

  // Validate mime type
  if (images.some(({ mimeType }) => !VALID_MIME_TYPES.includes(mimeType))) {
    return {
      success: false,
      error: {
        code: "INVALID_MIME_TYPE",
        message: `Invalid image type. Supported: ${VALID_MIME_TYPES.join(", ")}`,
      },
      metadata: {
        source: "image",
        confidence: "low",
        diagnostics: recordDiagnosticsStage(
          diagnostics,
          "ai",
          Date.now(),
          "skipped",
          "invalid_mime_type",
        ),
      },
    };
  }

  if (images.some(({ imageData }) => imageData.byteLength > MAX_IMAGE_SIZE)) {
    return {
      success: false,
      error: {
        code: "IMAGE_TOO_LARGE",
        message: `Image must be under ${MAX_IMAGE_SIZE / 1024 / 1024}MB`,
      },
      metadata: {
        source: "image",
        confidence: "low",
        diagnostics: recordDiagnosticsStage(
          diagnostics,
          "ai",
          Date.now(),
          "skipped",
          "image_too_large",
        ),
      },
    };
  }

  try {
    const aiStart = Date.now();
    const encodedImages = images.map(({ imageData, mimeType }) => ({
      imageData: Buffer.from(imageData).toString("base64"),
      mimeType,
    }));
    const aiResult =
      encodedImages.length === 1
        ? await parseRecipeFromImage(
            ai,
            encodedImages[0]!.imageData,
            encodedImages[0]!.mimeType,
          )
        : await parseRecipeFromImages(ai, encodedImages);
    diagnostics = recordDiagnosticsStage(
      appendFallbackPath(diagnostics, "ai"),
      "ai",
      aiStart,
    );
    const recipe = aiResultToRecipe(aiResult, {
      sourceType: "image",
      sourceUrl: null,
    });
    const candidateRecipe = {
      ...recipe,
      images: images.map(({ sourceImageUrl }) => sourceImageUrl),
    };
    const parsedResult = await acceptedCandidate(
      env,
      "image",
      candidateRecipe,
      "ai",
      {
        parseMethod: "ai_only",
        cache: false,
        metadataSource: "image",
        diagnostics,
      },
    );

    if (!parsedResult || !parsedResult.success) {
      return {
        success: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "AI output did not match expected schema",
        },
        metadata: {
          source: "image",
          confidence: "low",
          diagnostics,
        },
      };
    }

    return parsedResult;
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
        ...providerFailureFields(error),
      },
      metadata: {
        source: "image",
        confidence: "low",
        diagnostics,
      },
    };
  }
}
