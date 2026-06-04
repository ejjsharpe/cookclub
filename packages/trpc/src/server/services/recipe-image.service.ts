import type { ImageService, PublicImageAsset } from "@repo/contracts/images";
import { TRPCError } from "@trpc/server";

interface RecipeImageInput {
  images?: ({ url: string } | PublicImageAsset)[];
  imageUploadIds?: string[];
}

interface PrepareRecipeImagesDeps {
  imageService: ImageService;
  imagePublicUrl: string;
  ownerId: string;
}

export interface PreparedRecipeImages {
  images: PublicImageAsset[];
  movedKeys: string[];
}

function extensionFromKey(key: string) {
  return key.split(".").pop()?.toLowerCase() || "jpg";
}

function permanentRecipeImageKey(assetGroupId: string, extension = "jpg") {
  return `recipes/covers/${assetGroupId}/${crypto.randomUUID()}.${extension}`;
}

function imageKeyFromPublicUrl(url: string, publicUrl: string): string | null {
  const baseUrl = `${publicUrl.replace(/\/+$/, "")}/`;
  if (!url.startsWith(baseUrl)) return null;

  const encodedKey = url.slice(baseUrl.length).split(/[?#]/)[0] ?? "";
  try {
    const key = decodeURIComponent(encodedKey);
    if (!key || key.startsWith("/") || key.split("/").includes("..")) {
      return null;
    }
    return key;
  } catch {
    return null;
  }
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

async function prepareUploadedImages(
  input: RecipeImageInput,
  deps: PrepareRecipeImagesDeps,
  assetGroupId: string,
): Promise<PreparedRecipeImages> {
  const imageUploadIds = input.imageUploadIds ?? [];
  if (imageUploadIds.length === 0) return { images: [], movedKeys: [] };

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
      message: `Failed to move uploaded images: ${message}`,
    });
  }

  const missingAssetResult = moveResult.results.find((result) => !result.asset);
  if (missingAssetResult) {
    await cleanupMovedRecipeImages(deps.imageService, successfulMovedKeys);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Image move did not return asset metadata for ${missingAssetResult.to}`,
    });
  }

  const images = moveResult.results.map((result) => result.asset!);

  return {
    images,
    movedKeys: moves.map((move) => move.to),
  };
}

async function prepareDirectImages(
  input: RecipeImageInput,
  deps: PrepareRecipeImagesDeps,
  assetGroupId: string,
): Promise<PreparedRecipeImages> {
  const images = input.images ?? [];
  if (images.length === 0) return { images: [], movedKeys: [] };

  const preparedImages: PublicImageAsset[] = [];
  const movedKeys: string[] = [];

  for (const image of images) {
    if (isPublicImageAsset(image) && !image.storageKey.startsWith("temp/")) {
      preparedImages.push(image);
      continue;
    }

    const existingKey = imageKeyFromPublicUrl(image.url, deps.imagePublicUrl);
    const destinationKey = existingKey?.startsWith("temp/")
      ? permanentRecipeImageKey(assetGroupId, extensionFromKey(existingKey))
      : permanentRecipeImageKey(assetGroupId);

    try {
      if (existingKey?.startsWith("temp/")) {
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
        message:
          error instanceof Error
            ? `Failed to prepare image: ${error.message}`
            : "Failed to prepare image",
      });
    }
  }

  return { images: preparedImages, movedKeys };
}

export async function prepareRecipeImages(
  input: RecipeImageInput,
  deps: PrepareRecipeImagesDeps,
): Promise<PreparedRecipeImages> {
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

    return {
      images: [...directImages.images, ...uploadedImages.images],
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
