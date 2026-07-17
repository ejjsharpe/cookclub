import { Buffer } from "node:buffer";

import type { Env, ParseResult } from "../types";
import { parseRecipeFromImage } from "./ai-client";
import { aiResultToRecipe } from "./recipe-mapper";
import { acceptedCandidate } from "./url-parse-utils";
import type { AiClient } from "../utils/ai-response-parser";
import {
  appendFallbackPath,
  recordDiagnosticsStage,
} from "../utils/parse-diagnostics";

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const VALID_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

function imageBytes(imageData: string): Uint8Array<ArrayBuffer> {
  const binaryString = atob(imageData);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function normalizeImageForAi(
  env: Env,
  imageData: string,
  mimeType: string,
): Promise<{ imageData: string; mimeType: string }> {
  if (mimeType !== "image/webp") return { imageData, mimeType };

  const bytes = imageBytes(imageData);
  const normalized = await env.IMAGE_SERVICE.normalizeImage(
    bytes.buffer,
    "image/webp",
  );
  if (!normalized.success || !normalized.imageData) {
    throw new Error(normalized.error || "Failed to convert WebP image.");
  }

  return {
    imageData: Buffer.from(normalized.imageData).toString("base64"),
    mimeType: "image/jpeg",
  };
}

async function uploadSourceImage(
  env: Env,
  imageData: string,
  mimeType: string,
): Promise<string[]> {
  try {
    const bytes = imageBytes(imageData);

    const uploadResult = await env.IMAGE_SERVICE.uploadImage(
      bytes.buffer,
      mimeType as "image/jpeg" | "image/png" | "image/webp",
    );

    return uploadResult.success && uploadResult.publicUrl
      ? [uploadResult.publicUrl]
      : [];
  } catch (error) {
    console.log(
      "Source image upload failed:",
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}

/**
 * Parse a recipe from an image
 */
export async function parseImage(
  env: Env,
  imageData: string,
  mimeType: string,
  ai: AiClient,
): Promise<ParseResult> {
  let diagnostics = {};

  // Validate mime type
  if (!VALID_MIME_TYPES.includes(mimeType)) {
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

  // Validate base64 and estimate size
  try {
    const decodedLength = atob(imageData).length;
    if (decodedLength > MAX_IMAGE_SIZE) {
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
  } catch {
    return {
      success: false,
      error: {
        code: "INVALID_BASE64",
        message: "Invalid base64 image data",
      },
      metadata: {
        source: "image",
        confidence: "low",
        diagnostics: recordDiagnosticsStage(
          diagnostics,
          "ai",
          Date.now(),
          "skipped",
          "invalid_base64",
        ),
      },
    };
  }

  try {
    const aiStart = Date.now();
    const normalizedImage = await normalizeImageForAi(env, imageData, mimeType);
    const aiResult = await parseRecipeFromImage(
      ai,
      normalizedImage.imageData,
      normalizedImage.mimeType,
    );
    diagnostics = recordDiagnosticsStage(
      appendFallbackPath(diagnostics, "ai"),
      "ai",
      aiStart,
    );
    const recipe = aiResultToRecipe(aiResult, {
      sourceType: "image",
      sourceUrl: null,
    });
    const imageUploadStart = Date.now();
    const sourceImages = await uploadSourceImage(env, imageData, mimeType);
    diagnostics = recordDiagnosticsStage(
      diagnostics,
      "image_rehosting",
      imageUploadStart,
      sourceImages.length ? "success" : "skipped",
      sourceImages.length ? "source_image_uploaded" : "no_source_image_url",
    );
    const candidateRecipe = sourceImages.length
      ? { ...recipe, images: sourceImages }
      : recipe;
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
      },
      metadata: {
        source: "image",
        confidence: "low",
        diagnostics,
      },
    };
  }
}
