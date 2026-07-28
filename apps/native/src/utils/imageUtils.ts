import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
const PHOTO_MAX_BYTES = 4 * 1024 * 1024;
const IMPORT_SOURCE_MAX_BYTES = 10 * 1024 * 1024;
const AVATAR_MAX_BYTES = 512 * 1024;
const PHOTO_NORMALIZATION_ATTEMPTS = [
  { maxLongEdge: 2560, compress: 0.84 },
  { maxLongEdge: 2048, compress: 0.8 },
] as const;
const AVATAR_NORMALIZATION_ATTEMPTS = [
  { size: 512, compress: 0.84 },
  { size: 512, compress: 0.78 },
] as const;

export type UploadImageKind =
  | "recipe_photo"
  | "review_photo"
  | "avatar"
  | "recipe_import_source";

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
  maxBytes = PHOTO_MAX_BYTES,
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

    if (byteSize <= maxBytes) {
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
  if (kind === "avatar") return normalizeAvatarImage(uri);
  return normalizePhotoImage(
    uri,
    kind === "recipe_import_source" ? IMPORT_SOURCE_MAX_BYTES : PHOTO_MAX_BYTES,
  );
}
