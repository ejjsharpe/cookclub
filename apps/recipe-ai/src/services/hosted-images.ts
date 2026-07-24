import {
  imageKeyFromPublicUrl,
  isValidImportImageStagingId,
  publicImageUrlForKey,
} from "@repo/contracts/images";

import type { ParsedRecipe } from "../schema";
import type { Env, ParseResult } from "../types";
import {
  mergeResultDiagnostics,
  recordDiagnosticsStage,
} from "../utils/parse-diagnostics";
import { selectBestRecipeImages } from "../utils/recipe-quality";

interface RehostOptions {
  refreshGeneratedTemp?: boolean;
  imageStagingId?: string;
}

function imageStagingPrefix(imageStagingId: string | undefined) {
  return imageStagingId && isValidImportImageStagingId(imageStagingId)
    ? `imports/${imageStagingId}/`
    : null;
}

function generatedImageKey(imageStagingId: string | undefined) {
  const stagingPrefix = imageStagingPrefix(imageStagingId);
  return `${stagingPrefix ?? "temp/generated/"}${crypto.randomUUID()}.jpg`;
}

function hostedImageKey(
  env: Env,
  imageUrl: string | null | undefined,
): string | null {
  return imageKeyFromPublicUrl(imageUrl, env.IMAGE_PUBLIC_URL);
}

async function uploadImageUrlToStaging(
  env: Env,
  imageUrl: string,
  imageStagingId: string | undefined,
): Promise<string | null> {
  if (!env.IMAGE_SERVICE) return null;

  const destinationKey = generatedImageKey(imageStagingId);
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
  const stagingPrefix = imageStagingPrefix(options.imageStagingId);
  const isAlreadyStaged = stagingPrefix && key?.startsWith(stagingPrefix);
  const shouldRefreshTemporaryImage =
    options.refreshGeneratedTemp && key?.startsWith("temp/");

  if (
    key &&
    (isAlreadyStaged || (!stagingPrefix && !shouldRefreshTemporaryImage))
  ) {
    return imageUrl;
  }

  try {
    return await uploadImageUrlToStaging(env, imageUrl, options.imageStagingId);
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
): Promise<{
  recipe: ParsedRecipe;
  coverFailed: boolean;
  sourceImageCount: number;
  hostedImageCount: number;
}> {
  const sourceImages = selectBestRecipeImages(recipe.images ?? []);

  const hostedImages = (
    await Promise.all(
      sourceImages.map((imageUrl) => rehostImageUrl(env, imageUrl, options)),
    )
  ).filter((imageUrl): imageUrl is string => Boolean(imageUrl));

  const instructionSections = await Promise.all(
    recipe.instructionSections.map(async (section) => {
      const instructions = await Promise.all(
        section.instructions.map(async (instruction) => ({
          ...instruction,
          imageUrl: await rehostImageUrl(env, instruction.imageUrl, options),
        })),
      );

      return {
        ...section,
        instructions,
      };
    }),
  );

  return {
    recipe: {
      ...recipe,
      images: hostedImages,
      instructionSections,
    },
    coverFailed: sourceImages.length > 0 && hostedImages.length === 0,
    sourceImageCount: sourceImages.length,
    hostedImageCount: hostedImages.length,
  };
}

function rehostStageDetail(sourceImageCount: number, hostedImageCount: number) {
  return `cover_images:${hostedImageCount}/${sourceImageCount}`;
}

export async function rehostParsedRecipeImagesForResponse(
  env: Env,
  result: ParseResult,
  imageStagingId?: string,
): Promise<ParseResult> {
  const stageStart = Date.now();
  if (!result.success) {
    return mergeResultDiagnostics(
      result,
      result.metadata?.source ?? "url",
      (diagnostics) =>
        recordDiagnosticsStage(
          diagnostics,
          "image_rehosting",
          stageStart,
          "skipped",
          "parse_failed",
        ),
    );
  }

  const { recipe, coverFailed, sourceImageCount, hostedImageCount } =
    await rehostRecipeImages(env, result.data, {
      refreshGeneratedTemp: result.metadata.cached === true,
      imageStagingId,
    });
  const diagnostics = recordDiagnosticsStage(
    result.metadata.diagnostics,
    "image_rehosting",
    stageStart,
    sourceImageCount === 0 ? "skipped" : coverFailed ? "error" : "success",
    rehostStageDetail(sourceImageCount, hostedImageCount),
  );

  if (coverFailed) {
    return {
      success: false,
      error: {
        code: "IMAGE_REHOST_FAILED",
        message: "Could not store this recipe's image. Please try again.",
      },
      metadata: {
        ...result.metadata,
        confidence: "low",
        diagnostics,
      },
    };
  }

  return {
    ...result,
    data: recipe,
    metadata: {
      ...result.metadata,
      diagnostics,
    },
  };
}
