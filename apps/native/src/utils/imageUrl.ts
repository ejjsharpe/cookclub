import {
  IMAGE_TRANSFORM_PRESETS,
  imageKeyFromPublicUrl,
  type ImageTransformPresetName,
  type PublicImageAsset,
} from "@repo/contracts/images";
import { PixelRatio } from "react-native";

import { getImagePublicUrl } from "@/lib/runtimeConfig";

export const IMAGE_REQUEST_HEADERS = {
  Accept: "image/avif,image/webp,image/*,*/*",
};

type LegacyImagePreset =
  | "avatar-sm"
  | "avatar-lg"
  | "recipe-thumb"
  | "feed-review"
  | "recipe-card"
  | "recipe-hero"
  | "step-thumb"
  | "step-full";

export type ImagePreset = ImageTransformPresetName | LegacyImagePreset | "full";
export type ImageSourceAsset = PublicImageAsset | string | null | undefined;

const LEGACY_PRESET_MAP: Record<LegacyImagePreset, ImageTransformPresetName> = {
  "avatar-sm": "avatar_96",
  "avatar-lg": "avatar_192",
  "recipe-thumb": "thumb_200",
  "feed-review": "feed_960",
  "recipe-card": "feed_960",
  "recipe-hero": "detail_1600",
  "step-thumb": "step_thumb",
  "step-full": "detail_1600",
};

export function isPublicImageAsset(
  image: ImageSourceAsset,
): image is PublicImageAsset {
  return (
    typeof image === "object" &&
    image !== null &&
    "url" in image &&
    "storageKey" in image
  );
}

function getImageSourceUrl(image: ImageSourceAsset): string | undefined {
  if (!image) return undefined;
  return typeof image === "string" ? image : image.url;
}

function normalizePreset(preset: ImagePreset): ImageTransformPresetName | null {
  if (preset === "full") return null;
  if (preset in IMAGE_TRANSFORM_PRESETS) {
    return preset as ImageTransformPresetName;
  }
  return LEGACY_PRESET_MAP[preset as LegacyImagePreset];
}

function isHttpUrl(url: URL): boolean {
  return url.protocol === "http:" || url.protocol === "https:";
}

export function getImageUrl(
  image: ImageSourceAsset,
  preset: ImagePreset,
): string | undefined {
  const rawUrl = getImageSourceUrl(image);
  if (!rawUrl) return undefined;

  const normalizedPreset = normalizePreset(preset);

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  if (!isHttpUrl(url)) return rawUrl;

  const imagePublicUrl = getImagePublicUrl();
  if (!imageKeyFromPublicUrl(rawUrl, imagePublicUrl)) return undefined;

  if (!normalizedPreset) return rawUrl;

  const version = url.searchParams.get("v");
  url.search = "";
  url.searchParams.set("preset", normalizedPreset);
  if (version) {
    url.searchParams.set("v", version);
  }

  return url.toString();
}

export function selectFeedImagePreset(
  layoutWidth: number,
  pixelRatio = PixelRatio.get(),
): Extract<ImageTransformPresetName, "feed_720" | "feed_960" | "feed_1080"> {
  const targetWidth = Math.ceil(layoutWidth * pixelRatio);
  if (targetWidth <= 720) return "feed_720";
  if (targetWidth <= 960) return "feed_960";
  return "feed_1080";
}

export function selectDetailImagePreset(
  layoutWidth: number,
  pixelRatio = PixelRatio.get(),
): Extract<
  ImageTransformPresetName,
  "detail_1600" | "detail_2048" | "detail_2560"
> {
  const targetWidth = Math.ceil(layoutWidth * pixelRatio);
  if (targetWidth <= 1600) return "detail_1600";
  if (targetWidth <= 2048) return "detail_2048";
  return "detail_2560";
}

export function selectAvatarImagePreset(
  size: number,
  pixelRatio = PixelRatio.get(),
): Extract<ImageTransformPresetName, "avatar_96" | "avatar_192"> {
  return size * pixelRatio <= 96 ? "avatar_96" : "avatar_192";
}

export function appendImageVersion(
  url: string | null | undefined,
  version: Date | string | number | null | undefined,
): string | null | undefined {
  if (!url || version === null || version === undefined) return url;

  const versionValue =
    version instanceof Date ? version.getTime().toString() : String(version);
  if (!versionValue) return url;

  try {
    const parsedUrl = new URL(url);
    parsedUrl.searchParams.set("v", versionValue);
    return parsedUrl.toString();
  } catch {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}v=${encodeURIComponent(versionValue)}`;
  }
}
