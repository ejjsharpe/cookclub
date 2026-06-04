export type ImageContentType = "image/jpeg" | "image/png" | "image/webp";

export type ImageUploadKind = "recipe_photo" | "review_photo" | "avatar";

export interface PublicImageAsset {
  url: string;
  storageKey: string;
  width: number;
  height: number;
  contentType: ImageContentType;
  byteSize: number;
  thumbhash: string;
}

export interface StoredImageAsset extends PublicImageAsset {
  key: string;
  publicUrl: string;
}

export function normalizeImagePublicUrl(publicUrl: string): string {
  return publicUrl.replace(/\/+$/, "");
}

export function publicImageUrlForKey(publicUrl: string, key: string): string {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${normalizeImagePublicUrl(publicUrl)}/${encodedKey}`;
}

export function imageKeyFromPublicUrl(
  url: string | null | undefined,
  publicUrl: string,
): string | null {
  if (!url) return null;

  const baseUrl = `${normalizeImagePublicUrl(publicUrl)}/`;
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

export function isHostedImageUrl(
  url: string | null | undefined,
  publicUrl: string,
): boolean {
  return imageKeyFromPublicUrl(url, publicUrl) !== null;
}

export type ImageTransformFit = "crop" | "cover" | "contain" | "scale-down";
export type ImageTransformFormat = "auto";

export interface ImageTransformPreset {
  width: number;
  height?: number;
  fit: ImageTransformFit;
  quality: number;
  format: ImageTransformFormat;
  metadata: "none";
  anim: false;
  sharpen?: number;
}

export const IMAGE_TRANSFORM_PRESETS = {
  feed_720: {
    width: 720,
    height: 540,
    fit: "crop",
    quality: 76,
    sharpen: 1,
    format: "auto",
    metadata: "none",
    anim: false,
  },
  feed_960: {
    width: 960,
    height: 720,
    fit: "crop",
    quality: 78,
    sharpen: 1,
    format: "auto",
    metadata: "none",
    anim: false,
  },
  feed_1080: {
    width: 1080,
    height: 810,
    fit: "crop",
    quality: 80,
    sharpen: 1,
    format: "auto",
    metadata: "none",
    anim: false,
  },
  thumb_96: {
    width: 96,
    height: 96,
    fit: "crop",
    quality: 76,
    format: "auto",
    metadata: "none",
    anim: false,
  },
  thumb_200: {
    width: 200,
    height: 200,
    fit: "crop",
    quality: 78,
    format: "auto",
    metadata: "none",
    anim: false,
  },
  avatar_96: {
    width: 96,
    height: 96,
    fit: "crop",
    quality: 78,
    format: "auto",
    metadata: "none",
    anim: false,
  },
  avatar_192: {
    width: 192,
    height: 192,
    fit: "crop",
    quality: 80,
    format: "auto",
    metadata: "none",
    anim: false,
  },
  step_thumb: {
    width: 320,
    height: 240,
    fit: "crop",
    quality: 78,
    format: "auto",
    metadata: "none",
    anim: false,
  },
  detail_1600: {
    width: 1600,
    fit: "scale-down",
    quality: 82,
    format: "auto",
    metadata: "none",
    anim: false,
  },
  detail_2048: {
    width: 2048,
    fit: "scale-down",
    quality: 82,
    format: "auto",
    metadata: "none",
    anim: false,
  },
  detail_2560: {
    width: 2560,
    fit: "scale-down",
    quality: 84,
    format: "auto",
    metadata: "none",
    anim: false,
  },
  full_2560: {
    width: 2560,
    fit: "scale-down",
    quality: 84,
    format: "auto",
    metadata: "none",
    anim: false,
  },
} as const satisfies Record<string, ImageTransformPreset>;

export type ImageTransformPresetName = keyof typeof IMAGE_TRANSFORM_PRESETS;

export interface PresignedUrlResponse {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  maxFileSize: number;
  kind: ImageUploadKind;
}

export interface VerifyResponse {
  valid: boolean;
  results: { key: string; exists: boolean }[];
}

export interface MoveResult {
  from: string;
  to: string;
  success: boolean;
  asset?: StoredImageAsset;
  error?: string;
}

export interface MoveResponse {
  success: boolean;
  results: MoveResult[];
}

export interface UploadFromUrlResponse {
  success: boolean;
  publicUrl?: string;
  key?: string;
  asset?: StoredImageAsset;
  error?: string;
}

export interface UploadImageResponse {
  success: boolean;
  publicUrl?: string;
  key?: string;
  asset?: StoredImageAsset;
  error?: string;
}

export interface ImageService {
  presign(
    contentType: ImageContentType,
    ownerId: string,
    kind: ImageUploadKind,
  ): Promise<PresignedUrlResponse>;
  verify(keys: string[]): Promise<VerifyResponse>;
  move(
    moves: { from: string; to: string }[],
    ownerId?: string,
  ): Promise<MoveResponse>;
  delete(keys: string[]): Promise<void>;
  uploadFromUrl(
    sourceUrl: string,
    destinationKey: string,
  ): Promise<UploadFromUrlResponse>;
  uploadImage(
    imageData: ArrayBuffer,
    contentType: ImageContentType,
    ownerId?: string,
  ): Promise<UploadImageResponse>;
}
