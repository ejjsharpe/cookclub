import type {
  GenerateRecipeImageInput,
  GenerateRecipeImageResponse,
} from "@repo/contracts/recipe-ai";

import type { Env } from "../types";
import { generateReplicateImage } from "./replicate-image-client";

function createRecipeImagePrompt(input: GenerateRecipeImageInput): string {
  const ingredients = input.ingredients?.filter(Boolean).slice(0, 12) ?? [];
  const instructions = input.instructions?.filter(Boolean).slice(0, 4) ?? [];

  return [
    "Professional appetizing food photography of the finished dish.",
    `Dish: ${input.name.trim()}.`,
    input.description?.trim()
      ? `Description: ${input.description.trim()}.`
      : null,
    ingredients.length > 0
      ? `Visible ingredients: ${ingredients.join(", ")}.`
      : null,
    instructions.length > 0
      ? `Cooking context: ${instructions.join(" ")}`
      : null,
    "Natural light, realistic plating, no text, no watermark, no people, no hands, no packaging.",
  ]
    .filter(Boolean)
    .join(" ");
}

function randomImageSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000;
}

export async function generateRecipeImage(
  env: Env,
  input: GenerateRecipeImageInput,
): Promise<GenerateRecipeImageResponse> {
  try {
    if (!input.name.trim()) {
      return {
        success: false,
        error: {
          code: "MISSING_RECIPE_NAME",
          message: "Add a recipe title before creating an image.",
        },
      };
    }

    const imageData = await generateReplicateImage({
      apiToken: env.REPLICATE_API_TOKEN,
      prompt: createRecipeImagePrompt(input),
      seed: randomImageSeed(),
    });

    const uploadResult = await env.IMAGE_SERVICE.uploadImage(
      imageData,
      "image/jpeg",
      input.ownerId,
    );

    if (!uploadResult.success || !uploadResult.key || !uploadResult.publicUrl) {
      throw new Error(uploadResult.error || "Failed to store generated image.");
    }

    return {
      success: true,
      imageUploadId: uploadResult.key,
      publicUrl: uploadResult.publicUrl,
    };
  } catch (error) {
    console.error("Recipe image generation error:", error);
    return {
      success: false,
      error: {
        code: "IMAGE_GENERATION_ERROR",
        message:
          error instanceof Error
            ? error.message
            : "Failed to create recipe image. Please try again.",
      },
    };
  }
}
