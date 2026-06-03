import {
  IMAGE_TRANSFORM_PRESETS,
  type ImageTransformPreset,
  type ImageTransformPresetName,
} from "@repo/contracts/images";

import type { TransformOptions } from "./types";

const ALLOWED_QUERY_PARAMS = new Set(["preset", "v"]);

export function hasUnsupportedTransformParams(
  searchParams: URLSearchParams,
): boolean {
  return Array.from(searchParams.keys()).some(
    (key) => !ALLOWED_QUERY_PARAMS.has(key),
  );
}

export function parseTransformPreset(
  searchParams: URLSearchParams,
): ImageTransformPresetName | null {
  const preset = searchParams.get("preset");
  if (!preset) return null;

  return preset in IMAGE_TRANSFORM_PRESETS
    ? (preset as ImageTransformPresetName)
    : null;
}

export function hasTransformPreset(searchParams: URLSearchParams): boolean {
  return searchParams.has("preset");
}

export function getTransformPreset(
  preset: ImageTransformPresetName,
): ImageTransformPreset {
  return IMAGE_TRANSFORM_PRESETS[preset];
}

function resolveAutoFormat(
  acceptHeader: string | null,
): RequestInitCfPropertiesImage["format"] | undefined {
  if (acceptHeader?.includes("image/avif")) return "avif";
  if (acceptHeader?.includes("image/webp")) return "webp";
  return undefined;
}

/**
 * Build Cloudflare image transformation options for fetch.
 */
export function buildCfImageOptions(
  options: TransformOptions,
  acceptHeader: string | null,
): RequestInitCfPropertiesImage {
  const cfImage: RequestInitCfPropertiesImage = {
    width: options.width,
    fit: options.fit,
    quality: options.quality,
    metadata: "none",
    anim: false,
  };

  if (options.height) {
    cfImage.height = options.height;
  }

  if (options.sharpen) {
    cfImage.sharpen = options.sharpen;
  }

  if (options.format === "auto") {
    const negotiatedFormat = resolveAutoFormat(acceptHeader);
    if (negotiatedFormat) {
      cfImage.format = negotiatedFormat;
    }
  }

  return cfImage;
}
