import type { ImageService, PublicImageAsset } from "@repo/contracts/images";
import {
  imageKeyFromPublicUrl,
  publicImageUrlForKey,
} from "@repo/contracts/images";
import { TRPCError } from "@trpc/server";

interface RecipeInstructionImageInput {
  index: number;
  instruction: string;
  imageUrl?: string | null;
}

interface RecipeInstructionSectionInput {
  name: string | null;
  instructions: RecipeInstructionImageInput[];
}

interface RecipeImageInput {
  images?: ({ url: string } | PublicImageAsset)[];
  imageUploadIds?: string[];
  imageOrder?: RecipeImageOrderItem[];
  instructionSections?: RecipeInstructionSectionInput[];
}

export interface RecipeImageOrderItem {
  source: "image" | "upload";
  index: number;
}

interface PrepareRecipeImagesDeps {
  imageService: ImageService;
  imagePublicUrl: string;
  ownerId: string;
}

export interface PreparedRecipeImages {
  images: PublicImageAsset[];
  instructionSections: RecipeInstructionSectionInput[];
  movedKeys: string[];
}

function validateImageOrder(input: RecipeImageInput): void {
  const { imageOrder } = input;
  if (!imageOrder) return;

  const directImageCount = input.images?.length ?? 0;
  const uploadedImageCount = input.imageUploadIds?.length ?? 0;
  const totalImages = directImageCount + uploadedImageCount;
  if (imageOrder.length !== totalImages) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Image order must include every recipe image",
    });
  }

  const seen = new Set<string>();
  for (const item of imageOrder) {
    const key = `${item.source}:${item.index}`;
    const sourceImageCount =
      item.source === "image" ? directImageCount : uploadedImageCount;

    if (
      !Number.isInteger(item.index) ||
      item.index < 0 ||
      item.index >= sourceImageCount ||
      seen.has(key)
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Image order contains an invalid image reference",
      });
    }

    seen.add(key);
  }
}

function applyImageOrder(
  directImages: PublicImageAsset[],
  uploadedImages: PublicImageAsset[],
  imageOrder: RecipeImageOrderItem[] | undefined,
): PublicImageAsset[] {
  if (!imageOrder) return [...directImages, ...uploadedImages];

  return imageOrder.map((item) => {
    const sourceImages =
      item.source === "image" ? directImages : uploadedImages;
    return sourceImages[item.index]!;
  });
}

function extensionFromKey(key: string) {
  return key.split(".").pop()?.toLowerCase() || "jpg";
}

function permanentRecipeImageKey(assetGroupId: string, extension = "jpg") {
  return `recipes/covers/${assetGroupId}/${crypto.randomUUID()}.${extension}`;
}

function permanentInstructionImageKey(
  assetGroupId: string,
  stepIndex: number,
  extension = "jpg",
) {
  return `recipes/instructions/${assetGroupId}/${stepIndex}/${crypto.randomUUID()}.${extension}`;
}

function isPublicImageAsset(
  image: { url: string } | PublicImageAsset,
): image is PublicImageAsset {
  return (
    "storageKey" in image &&
    "width" in image &&
    "height" in image &&
    "contentType" in image &&
    "byteSize" in image &&
    "thumbhash" in image
  );
}

function shouldMoveTemporaryImage(key: string | null): key is string {
  return Boolean(
    key?.startsWith("temp/") && !key.startsWith("temp/generated/"),
  );
}

async function prepareUploadedImages(
  input: RecipeImageInput,
  deps: PrepareRecipeImagesDeps,
  assetGroupId: string,
): Promise<PreparedRecipeImages> {
  const imageUploadIds = input.imageUploadIds ?? [];
  if (imageUploadIds.length === 0) {
    return { images: [], instructionSections: [], movedKeys: [] };
  }

  const moves = imageUploadIds.map((uploadId) => ({
    from: uploadId,
    to: permanentRecipeImageKey(assetGroupId, extensionFromKey(uploadId)),
  }));

  const moveResult = await deps.imageService.move(moves, deps.ownerId);
  const successfulMovedKeys = moveResult.results
    .filter((result) => result.success)
    .map((result) => result.to);

  if (!moveResult.success) {
    await cleanupMovedRecipeImages(deps.imageService, successfulMovedKeys);

    const failedMoves = moveResult.results.filter((result) => !result.success);
    const message = failedMoves
      .map((result) => `${result.from} -> ${result.to}: ${result.error}`)
      .join(", ");
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      cause: new Error(`Failed to move uploaded images: ${message}`),
    });
  }

  const missingAssetResult = moveResult.results.find((result) => !result.asset);
  if (missingAssetResult) {
    await cleanupMovedRecipeImages(deps.imageService, successfulMovedKeys);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      cause: new Error(
        `Image move did not return asset metadata for ${missingAssetResult.to}`,
      ),
    });
  }

  const images = moveResult.results.map((result) => result.asset!);

  return {
    images,
    instructionSections: [],
    movedKeys: moves.map((move) => move.to),
  };
}

async function prepareDirectImages(
  input: RecipeImageInput,
  deps: PrepareRecipeImagesDeps,
  assetGroupId: string,
): Promise<PreparedRecipeImages> {
  const images = input.images ?? [];
  if (images.length === 0) {
    return { images: [], instructionSections: [], movedKeys: [] };
  }

  const preparedImages: PublicImageAsset[] = [];
  const movedKeys: string[] = [];

  for (const image of images) {
    if (
      isPublicImageAsset(image) &&
      !image.storageKey.startsWith("temp/") &&
      !image.storageKey.startsWith("imports/")
    ) {
      preparedImages.push(image);
      continue;
    }

    const existingKey = imageKeyFromPublicUrl(image.url, deps.imagePublicUrl);
    const destinationKey = existingKey?.startsWith("temp/")
      ? permanentRecipeImageKey(assetGroupId, extensionFromKey(existingKey))
      : permanentRecipeImageKey(assetGroupId);

    try {
      if (shouldMoveTemporaryImage(existingKey)) {
        const moveResult = await deps.imageService.move(
          [{ from: existingKey, to: destinationKey }],
          deps.ownerId,
        );
        const result = moveResult.results[0];
        if (!moveResult.success || !result?.success) {
          throw new Error(result?.error || "Failed to move temporary image");
        }
        movedKeys.push(result.to);
        if (!result.asset) {
          throw new Error("Moved image did not return asset metadata");
        }
        preparedImages.push(result.asset);
      } else {
        const result = await deps.imageService.uploadFromUrl(
          image.url,
          destinationKey,
        );
        if (!result.success) {
          throw new Error(result.error || "Failed to store remote image");
        }
        movedKeys.push(destinationKey);
        if (!result.asset) {
          throw new Error("Stored remote image did not return asset metadata");
        }
        preparedImages.push(result.asset);
      }
    } catch (error) {
      await cleanupMovedRecipeImages(deps.imageService, movedKeys);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        cause: error,
      });
    }
  }

  return { images: preparedImages, instructionSections: [], movedKeys };
}

async function moveInstructionImage(
  sourceKey: string,
  destinationKey: string,
  deps: PrepareRecipeImagesDeps,
): Promise<string> {
  const moveResult = await deps.imageService.move(
    [{ from: sourceKey, to: destinationKey }],
    deps.ownerId,
  );
  const result = moveResult.results[0];
  if (!moveResult.success || !result?.success) {
    throw new Error(result?.error || "Failed to move instruction image");
  }

  return publicImageUrlForKey(deps.imagePublicUrl, result.to);
}

async function uploadInstructionImage(
  sourceUrl: string,
  destinationKey: string,
  deps: PrepareRecipeImagesDeps,
): Promise<string> {
  const result = await deps.imageService.uploadFromUrl(
    sourceUrl,
    destinationKey,
  );
  if (!result.success) {
    throw new Error(result.error || "Failed to store instruction image");
  }

  return (
    result.asset?.publicUrl ??
    result.publicUrl ??
    publicImageUrlForKey(deps.imagePublicUrl, result.key ?? destinationKey)
  );
}

async function prepareInstructionImageUrl(
  imageUrl: string | null | undefined,
  deps: PrepareRecipeImagesDeps,
  assetGroupId: string,
  stepIndex: number,
  movedKeys: string[],
): Promise<string | null> {
  if (!imageUrl) return null;

  const existingKey = imageKeyFromPublicUrl(imageUrl, deps.imagePublicUrl);
  const extension = existingKey ? extensionFromKey(existingKey) : "jpg";
  const destinationKey = permanentInstructionImageKey(
    assetGroupId,
    stepIndex,
    extension,
  );

  try {
    if (shouldMoveTemporaryImage(existingKey)) {
      const publicUrl = await moveInstructionImage(
        existingKey,
        destinationKey,
        deps,
      );
      movedKeys.push(destinationKey);
      return publicUrl;
    }

    const publicUrl = await uploadInstructionImage(
      imageUrl,
      destinationKey,
      deps,
    );
    movedKeys.push(destinationKey);
    return publicUrl;
  } catch (error) {
    console.warn(
      JSON.stringify({
        task: "prepare-instruction-image",
        publicCode: "SERVICE_UNAVAILABLE",
        errorStack:
          error instanceof Error ? error.stack : "Non-Error image failure",
      }),
    );
    return null;
  }
}

async function prepareInstructionImages(
  input: RecipeImageInput,
  deps: PrepareRecipeImagesDeps,
  assetGroupId: string,
  movedKeys: string[],
): Promise<RecipeInstructionSectionInput[]> {
  const sections = input.instructionSections ?? [];
  let stepIndex = 0;
  const preparedSections: RecipeInstructionSectionInput[] = [];

  for (const section of sections) {
    const instructions: RecipeInstructionImageInput[] = [];

    for (const instruction of section.instructions) {
      const currentStepIndex = stepIndex;
      stepIndex++;

      instructions.push({
        ...instruction,
        imageUrl: await prepareInstructionImageUrl(
          instruction.imageUrl,
          deps,
          assetGroupId,
          currentStepIndex,
          movedKeys,
        ),
      });
    }

    preparedSections.push({
      ...section,
      instructions,
    });
  }

  return preparedSections;
}

export async function prepareRecipeImages(
  input: RecipeImageInput,
  deps: PrepareRecipeImagesDeps,
): Promise<PreparedRecipeImages> {
  validateImageOrder(input);

  const assetGroupId = crypto.randomUUID();
  const movedKeys: string[] = [];

  try {
    const directImages = await prepareDirectImages(input, deps, assetGroupId);
    movedKeys.push(...directImages.movedKeys);

    const uploadedImages = await prepareUploadedImages(
      input,
      deps,
      assetGroupId,
    );
    movedKeys.push(...uploadedImages.movedKeys);

    const instructionSections = await prepareInstructionImages(
      input,
      deps,
      assetGroupId,
      movedKeys,
    );

    return {
      images: applyImageOrder(
        directImages.images,
        uploadedImages.images,
        input.imageOrder,
      ),
      instructionSections,
      movedKeys,
    };
  } catch (error) {
    await cleanupMovedRecipeImages(deps.imageService, movedKeys);
    throw error;
  }
}

export async function cleanupMovedRecipeImages(
  imageService: ImageService,
  movedKeys: string[],
) {
  if (movedKeys.length === 0) return;

  try {
    await imageService.delete(movedKeys);
  } catch (err) {
    console.error("Failed to clean up moved recipe images:", err);
  }
}
