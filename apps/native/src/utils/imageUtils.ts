import { readAsStringAsync, EncodingType } from "expo-file-system/legacy";
import {
  manipulateAsync,
  SaveFormat,
  ImageResult,
} from "expo-image-manipulator";

const MAX_IMAGE_DIMENSION = 480;
const MIN_IMAGE_DIMENSION = 224; // Minimum size for vision models
const PHOTO_MAX_BYTES = 4 * 1024 * 1024;
const AVATAR_MAX_BYTES = 512 * 1024;
const PHOTO_NORMALIZATION_ATTEMPTS = [
  { maxLongEdge: 2560, compress: 0.84 },
  { maxLongEdge: 2048, compress: 0.8 },
] as const;
const AVATAR_NORMALIZATION_ATTEMPTS = [
  { size: 512, compress: 0.84 },
  { size: 512, compress: 0.78 },
] as const;

export interface ResizedImage {
  base64: string;
  mimeType: "image/jpeg";
}

export type UploadImageKind = "recipe_photo" | "review_photo" | "avatar";

export interface NormalizedUploadImage {
  uri: string;
  contentType: "image/jpeg";
  width: number;
  height: number;
  byteSize: number;
}

async function getBlobSize(uri: string): Promise<number> {
  const response = await fetch(uri);
  const blob = await response.blob();
  return blob.size;
}

function resizeToLongEdge(width: number, height: number, maxLongEdge: number) {
  if (width <= maxLongEdge && height <= maxLongEdge) {
    return { width, height };
  }

  if (width >= height) {
    return {
      width: maxLongEdge,
      height: Math.round((maxLongEdge / width) * height),
    };
  }

  return {
    width: Math.round((maxLongEdge / height) * width),
    height: maxLongEdge,
  };
}

async function normalizePhotoImage(
  uri: string,
): Promise<NormalizedUploadImage> {
  const original = await manipulateAsync(uri, []);

  for (const attempt of PHOTO_NORMALIZATION_ATTEMPTS) {
    const size = resizeToLongEdge(
      original.width,
      original.height,
      attempt.maxLongEdge,
    );
    const actions =
      size.width === original.width && size.height === original.height
        ? []
        : [{ resize: size }];
    const normalized = await manipulateAsync(uri, actions, {
      compress: attempt.compress,
      format: SaveFormat.JPEG,
    });
    const byteSize = await getBlobSize(normalized.uri);

    if (byteSize <= PHOTO_MAX_BYTES) {
      return {
        uri: normalized.uri,
        contentType: "image/jpeg",
        width: normalized.width,
        height: normalized.height,
        byteSize,
      };
    }
  }

  throw new Error("Image is too large after compression.");
}

async function normalizeAvatarImage(
  uri: string,
): Promise<NormalizedUploadImage> {
  const original = await manipulateAsync(uri, []);
  const cropSize = Math.min(original.width, original.height);
  const crop = {
    originX: Math.round((original.width - cropSize) / 2),
    originY: Math.round((original.height - cropSize) / 2),
    width: cropSize,
    height: cropSize,
  };

  for (const attempt of AVATAR_NORMALIZATION_ATTEMPTS) {
    const normalized = await manipulateAsync(
      uri,
      [{ crop }, { resize: { width: attempt.size, height: attempt.size } }],
      {
        compress: attempt.compress,
        format: SaveFormat.JPEG,
      },
    );
    const byteSize = await getBlobSize(normalized.uri);

    if (byteSize <= AVATAR_MAX_BYTES) {
      return {
        uri: normalized.uri,
        contentType: "image/jpeg",
        width: normalized.width,
        height: normalized.height,
        byteSize,
      };
    }
  }

  throw new Error("Avatar image is too large after compression.");
}

export async function normalizeImageForUpload(
  uri: string,
  kind: UploadImageKind,
): Promise<NormalizedUploadImage> {
  return kind === "avatar"
    ? normalizeAvatarImage(uri)
    : normalizePhotoImage(uri);
}

/**
 * Resizes an image and converts it to base64.
 * Always outputs JPEG for optimal size/quality for vision models.
 */
export async function imageToBase64(
  uri: string,
  options?: { maxDimension?: number },
): Promise<ResizedImage> {
  const maxDimension = options?.maxDimension ?? MAX_IMAGE_DIMENSION;

  // First get image dimensions to resize proportionally
  const original = await manipulateAsync(uri, []);
  const { width, height } = original;

  // Calculate new dimensions maintaining aspect ratio
  let newWidth: number;
  let newHeight: number;

  if (width > height) {
    newWidth = Math.min(width, maxDimension);
    newHeight = Math.round((newWidth / width) * height);
    // Ensure minimum height
    if (newHeight < MIN_IMAGE_DIMENSION) {
      newHeight = MIN_IMAGE_DIMENSION;
      newWidth = Math.round((newHeight / height) * width);
    }
  } else {
    newHeight = Math.min(height, maxDimension);
    newWidth = Math.round((newHeight / height) * width);
    // Ensure minimum width
    if (newWidth < MIN_IMAGE_DIMENSION) {
      newWidth = MIN_IMAGE_DIMENSION;
      newHeight = Math.round((newWidth / width) * height);
    }
  }

  // Resize the image
  const resized: ImageResult = await manipulateAsync(
    uri,
    [{ resize: { width: newWidth, height: newHeight } }],
    { compress: 0.5, format: SaveFormat.JPEG },
  );

  const base64 = await readAsStringAsync(resized.uri, {
    encoding: EncodingType.Base64,
  });

  return { base64, mimeType: "image/jpeg" };
}
