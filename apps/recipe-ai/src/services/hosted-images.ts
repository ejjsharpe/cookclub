import {
  imageKeyFromPublicUrl,
  publicImageUrlForKey,
} from "@repo/contracts/images";

import type { ParsedRecipe } from "../schema";
import type { Env, ParseResult } from "../types";
import { selectBestRecipeImages } from "../utils/recipe-quality";

interface RehostOptions {
  refreshGeneratedTemp?: boolean;
}

function generatedTempImageKey() {
  return `temp/generated/${crypto.randomUUID()}.jpg`;
}

function hostedImageKey(
  env: Env,
  imageUrl: string | null | undefined,
): string | null {
  return imageKeyFromPublicUrl(imageUrl, env.IMAGE_PUBLIC_URL);
}

async function uploadImageUrlToGeneratedTemp(
  env: Env,
  imageUrl: string,
): Promise<string | null> {
  if (!env.IMAGE_SERVICE) return null;

  const destinationKey = generatedTempImageKey();
  const result = await env.IMAGE_SERVICE.uploadFromUrl(
    imageUrl,
    destinationKey,
  );

  if (!result.success) {
    console.log(
      "[rehost] Failed to upload image:",
      result.error || "Unknown image upload error",
    );
    return null;
  }

  return (
    result.asset?.publicUrl ??
    result.publicUrl ??
    publicImageUrlForKey(env.IMAGE_PUBLIC_URL, result.key ?? destinationKey)
  );
}

async function rehostImageUrl(
  env: Env,
  imageUrl: string | null | undefined,
  options: RehostOptions,
): Promise<string | null> {
  if (!imageUrl) return null;

  const key = hostedImageKey(env, imageUrl);
  if (key && (!options.refreshGeneratedTemp || !key.startsWith("temp/"))) {
    return imageUrl;
  }

  try {
    return await uploadImageUrlToGeneratedTemp(env, imageUrl);
  } catch (error) {
    console.log(
      "[rehost] Error uploading image:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

async function rehostRecipeImages(
  env: Env,
  recipe: ParsedRecipe,
  options: RehostOptions,
): Promise<{ recipe: ParsedRecipe; coverFailed: boolean }> {
  const sourceImages = selectBestRecipeImages(recipe.images ?? []);
  const hostedImages: string[] = [];

  for (const imageUrl of sourceImages) {
    const hostedUrl = await rehostImageUrl(env, imageUrl, options);
    if (hostedUrl) {
      hostedImages.push(hostedUrl);
    }
  }

  const instructionSections = [];
  for (const section of recipe.instructionSections) {
    const instructions = [];
    for (const instruction of section.instructions) {
      instructions.push({
        ...instruction,
        imageUrl: await rehostImageUrl(env, instruction.imageUrl, options),
      });
    }
    instructionSections.push({
      ...section,
      instructions,
    });
  }

  return {
    recipe: {
      ...recipe,
      images: hostedImages,
      instructionSections,
    },
    coverFailed: sourceImages.length > 0 && hostedImages.length === 0,
  };
}

export async function rehostParsedRecipeImagesForResponse(
  env: Env,
  result: ParseResult,
): Promise<ParseResult> {
  if (!result.success) return result;

  const { recipe, coverFailed } = await rehostRecipeImages(env, result.data, {
    refreshGeneratedTemp: result.metadata.cached === true,
  });

  if (coverFailed) {
    return {
      success: false,
      error: {
        code: "IMAGE_REHOST_FAILED",
        message: "Could not store this recipe's image. Please try again.",
      },
    };
  }

  return {
    ...result,
    data: recipe,
  };
}
