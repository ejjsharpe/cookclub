import type { Env, ParseResult } from "../types";
import { parseRecipeFromImage } from "./ai-client";
import { aiResultToRecipe } from "./recipe-mapper";
import { acceptedCandidate } from "./url-parse-utils";

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const VALID_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

async function uploadSourceImage(
  env: Env,
  imageData: string,
  mimeType: string,
): Promise<string[]> {
  if (!env.IMAGE_SERVICE) return [];

  try {
    const binaryString = atob(imageData);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const imageBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    const uploadResult = await env.IMAGE_SERVICE.uploadImage(
      imageBuffer,
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
): Promise<ParseResult> {
  // Validate mime type
  if (!VALID_MIME_TYPES.includes(mimeType)) {
    return {
      success: false,
      error: {
        code: "INVALID_MIME_TYPE",
        message: `Invalid image type. Supported: ${VALID_MIME_TYPES.join(", ")}`,
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
      };
    }
  } catch {
    return {
      success: false,
      error: {
        code: "INVALID_BASE64",
        message: "Invalid base64 image data",
      },
    };
  }

  try {
    const aiResult = await parseRecipeFromImage(env.AI, imageData, mimeType);
    const recipe = aiResultToRecipe(aiResult, {
      sourceType: "image",
      sourceUrl: null,
    });
    const sourceImages = await uploadSourceImage(env, imageData, mimeType);
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
      },
    );

    if (!parsedResult || !parsedResult.success) {
      return {
        success: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "AI output did not match expected schema",
        },
      };
    }

    return parsedResult;
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
