import type {
  ImageContentType,
  ImageUploadKind,
  StoredImageAsset,
} from "@repo/contracts/images";
import {
  imageKeyFromPublicUrl,
  publicImageUrlForKey,
} from "@repo/contracts/images";
import { WorkerEntrypoint } from "cloudflare:workers";
import { Hono } from "hono";
import { cors } from "hono/cors";

import {
  extensionFromContentType,
  generateGeneratedTempKey,
  generatePresignedUploadUrl,
  generateUserTempKey,
  isOwnedTempKey,
  validateKey,
} from "./presign";
import type { UploadFromUrlResponse, UploadImageResponse } from "./service";
import { createThumbhashFromJpegBytes } from "./thumbhash";
import {
  getTransformPreset,
  hasTransformPreset,
  hasUnsupportedTransformParams,
  parseTransformPreset,
} from "./transform";
import type {
  Env,
  PresignedUrlResponse,
  VerifyResponse,
  MoveResult,
  MoveResponse,
} from "./types";

// Re-export types for consumers
export type {
  PresignedUrlResponse,
  VerifyResponse,
  MoveResult,
  MoveResponse,
} from "./types";
export type { UploadFromUrlResponse, UploadImageResponse } from "./service";

const PHOTO_MAX_FILE_SIZE = 4 * 1024 * 1024;
const AVATAR_MAX_FILE_SIZE = 512 * 1024;
const TRUSTED_SOURCE_MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_REMOTE_IMAGE_REDIRECTS = 3;
const ORIGIN_FETCH_HEADER = "x-cookclub-origin-fetch";
const TRANSFORM_STATUS_HEADER = "x-cookclub-image-transform";
const IMAGE_ACCEPT_HEADER = "image/avif,image/webp,image/*,*/*";
const NORMALIZED_IMAGE_TYPE = "image/jpeg" satisfies ImageContentType;
const FALLBACK_THUMBHASH = "";

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }

  const a = parts[0]!;
  const b = parts[1]!;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function validateRemoteImageUrl(sourceUrl: string): URL {
  const url = new URL(sourceUrl);
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only HTTP and HTTPS image URLs are supported");
  }

  if (
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "::1" ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd") ||
    hostname.startsWith("fe80:") ||
    isPrivateIpv4(hostname)
  ) {
    throw new Error("This image host is not supported");
  }

  return url;
}

function getMaxFileSizeForKind(kind: ImageUploadKind): number {
  return kind === "avatar" ? AVATAR_MAX_FILE_SIZE : PHOTO_MAX_FILE_SIZE;
}

function getMaxFileSizeForDestinationKey(key: string): number {
  return key.startsWith("avatars/")
    ? AVATAR_MAX_FILE_SIZE
    : PHOTO_MAX_FILE_SIZE;
}

function isAllowedImageContentType(
  contentType: string | null | undefined,
): contentType is ImageContentType {
  return (
    contentType === "image/jpeg" ||
    contentType === "image/png" ||
    contentType === "image/webp"
  );
}

function imageUrlForKey(env: Env, key: string): string {
  return publicImageUrlForKey(env.PUBLIC_URL, key);
}

function originUrlForKey(env: Env, key: string): string {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${env.R2_ORIGIN_URL.replace(/\/+$/, "")}/${encodedKey}`;
}

function hasArrayBuffer(
  value: unknown,
): value is { arrayBuffer: () => Promise<ArrayBuffer> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    typeof value.arrayBuffer === "function"
  );
}

function parseJpegDimensions(data: ArrayBuffer) {
  const bytes = new Uint8Array(data);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 9 < bytes.length) {
    while (bytes[offset] === 0xff) offset++;

    const marker = bytes[offset++];
    if (marker === undefined) return null;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;

    if (offset + 2 > bytes.length) return null;

    const segmentLength = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      return null;
    }

    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isStartOfFrame) {
      return {
        height: (bytes[offset + 3]! << 8) | bytes[offset + 4]!,
        width: (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
      };
    }

    offset += segmentLength;
  }

  return null;
}

async function fetchStoredImageTransform(
  env: Env,
  key: string,
  image: RequestInitCfPropertiesImage,
  acceptHeader = IMAGE_ACCEPT_HEADER,
): Promise<Response> {
  return fetch(originUrlForKey(env, key), {
    headers: {
      Accept: acceptHeader,
      [ORIGIN_FETCH_HEADER]: "1",
    },
    cf: {
      image,
      cacheEverything: true,
      cacheTtl: 31536000,
    },
  });
}

function imageBindingOutputFormat(
  acceptHeader: string | null,
): ImageOutputOptions["format"] {
  if (acceptHeader?.includes("image/avif")) return "image/avif";
  if (acceptHeader?.includes("image/webp")) return "image/webp";
  return NORMALIZED_IMAGE_TYPE;
}

function imageBindingTransformOptions(
  options: ReturnType<typeof getTransformPreset>,
): ImageTransform {
  return {
    width: options.width,
    ...(options.height ? { height: options.height } : {}),
    fit: options.fit,
    ...(options.sharpen ? { sharpen: options.sharpen } : {}),
  };
}

async function transformStoredImageWithBinding(
  env: Env,
  key: string,
  preset: ReturnType<typeof parseTransformPreset>,
  acceptHeader: string | null,
): Promise<Response> {
  if (!preset) {
    return Response.json(
      { error: "Unsupported image transformation preset" },
      { status: 400 },
    );
  }

  const object = await env.IMAGES.get(key);
  if (!object) {
    return Response.json({ error: "Image not found" }, { status: 404 });
  }

  const transformOptions = getTransformPreset(preset);
  const result = await env.IMAGE_TRANSFORMER.input(object.body)
    .transform(imageBindingTransformOptions(transformOptions))
    .output({
      format: imageBindingOutputFormat(acceptHeader),
      quality: transformOptions.quality,
      anim: transformOptions.anim,
    });

  const response = result.response();
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("Vary", "Accept");
  headers.set(TRANSFORM_STATUS_HEADER, "transformed");
  if (!headers.has("ETag")) {
    headers.set(
      "ETag",
      `W/"${encodeURIComponent(key)}:${preset}:${imageBindingOutputFormat(acceptHeader)}"`,
    );
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function buildStoredImageAsset(
  env: Env,
  key: string,
): Promise<StoredImageAsset> {
  const object = await env.IMAGES.get(key);
  if (!object) {
    throw new Error("Stored image not found");
  }

  const contentType = object.httpMetadata?.contentType;
  if (!isAllowedImageContentType(contentType)) {
    throw new Error("Stored image metadata is incomplete");
  }

  const data = hasArrayBuffer(object) ? await object.arrayBuffer() : null;
  const dimensions =
    contentType === NORMALIZED_IMAGE_TYPE && data
      ? parseJpegDimensions(data)
      : null;

  if (!dimensions) {
    throw new Error("Stored image metadata is incomplete");
  }

  let thumbhash = FALLBACK_THUMBHASH;
  if (data) {
    try {
      thumbhash = createThumbhashFromJpegBytes(data);
    } catch (error) {
      console.log(
        JSON.stringify({
          event: "image_thumbhash_failed",
          storageKey: key,
          message: error instanceof Error ? error.message : "Unknown error",
        }),
      );
    }
  }

  const publicUrl = imageUrlForKey(env, key);

  return {
    url: publicUrl,
    publicUrl,
    storageKey: key,
    key,
    width: dimensions.width,
    height: dimensions.height,
    contentType,
    byteSize: object.size,
    thumbhash,
  };
}

async function readNormalizedRemoteImage(
  url: URL,
  maxFileSize: number,
): Promise<ArrayBuffer> {
  const attempts = [
    { width: 2560, quality: 84 },
    { width: 2048, quality: 80 },
  ];

  let lastSize = 0;

  for (const attempt of attempts) {
    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: IMAGE_ACCEPT_HEADER,
      },
      redirect: "manual",
      cf: {
        image: {
          width: attempt.width,
          fit: "scale-down",
          quality: attempt.quality,
          format: "jpeg",
          metadata: "none",
          anim: false,
        },
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to normalize image: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.arrayBuffer();
    lastSize = data.byteLength;
    if (data.byteLength <= maxFileSize) {
      return data;
    }
  }

  throw new Error(`Image too large: ${lastSize} bytes (max ${maxFileSize})`);
}

async function normalizeStoredObjectToJpeg(
  env: Env,
  sourceKey: string,
  destinationKey: string,
  maxFileSize: number,
): Promise<void> {
  const attempts = [
    { width: 2560, quality: 84 },
    { width: 2048, quality: 80 },
  ];

  let lastSize = 0;

  for (const attempt of attempts) {
    const response = await fetchStoredImageTransform(env, sourceKey, {
      width: attempt.width,
      fit: "scale-down",
      quality: attempt.quality,
      format: "jpeg",
      metadata: "none",
      anim: false,
    });

    if (!response.ok) {
      throw new Error(`Failed to normalize stored image: ${response.status}`);
    }

    const data = await response.arrayBuffer();
    lastSize = data.byteLength;
    if (data.byteLength > maxFileSize) continue;

    await env.IMAGES.put(destinationKey, data, {
      httpMetadata: { contentType: NORMALIZED_IMAGE_TYPE },
    });
    return;
  }

  throw new Error(`Image too large: ${lastSize} bytes (max ${maxFileSize})`);
}

async function copyHostedImage(
  env: Env,
  sourceKey: string,
  destinationKey: string,
): Promise<StoredImageAsset> {
  const source = await env.IMAGES.get(sourceKey);
  if (!source) {
    throw new Error("Source not found");
  }

  const contentType = source.httpMetadata?.contentType;
  if (!isAllowedImageContentType(contentType)) {
    throw new Error("Invalid stored image content type");
  }

  const maxFileSize = getMaxFileSizeForDestinationKey(destinationKey);
  if (source.size > maxFileSize) {
    throw new Error(
      `Image too large: ${source.size} bytes (max ${maxFileSize})`,
    );
  }

  await env.IMAGES.put(destinationKey, source.body, {
    httpMetadata: source.httpMetadata,
    customMetadata: source.customMetadata,
  });

  return await buildStoredImageAsset(env, destinationKey);
}

/**
 * Image service RPC entrypoint.
 *
 * Provides RPC methods for image upload management.
 * Called via Service Bindings from the API and recipe AI Workers.
 */
export class ImageService extends WorkerEntrypoint<Env> {
  /**
   * Generate a presigned URL for uploading an image to R2.
   *
   * @param contentType - The MIME type of the image
   * @param kind - The normalized asset kind being uploaded
   * @returns Presigned upload URL, public URL, and storage key
   */
  async presign(
    contentType: ImageContentType,
    ownerId: string,
    kind: ImageUploadKind,
  ): Promise<PresignedUrlResponse> {
    if (!isAllowedImageContentType(contentType)) {
      throw new Error("Invalid content type");
    }

    const maxFileSize = getMaxFileSizeForKind(kind);
    const extension = extensionFromContentType(NORMALIZED_IMAGE_TYPE);
    const key = generateUserTempKey(ownerId, extension);

    const response = await generatePresignedUploadUrl(this.env, {
      key,
      contentType: NORMALIZED_IMAGE_TYPE,
      maxFileSize,
    });

    return { ...response, kind };
  }

  /**
   * Verify that uploaded images exist in storage.
   *
   * @param keys - Array of storage keys to verify
   * @returns Verification results for each key
   */
  async verify(keys: string[]): Promise<VerifyResponse> {
    const results = await Promise.all(
      keys.map(async (key) => {
        const object = await this.env.IMAGES.head(key);
        const contentType = object?.httpMetadata?.contentType;
        const exists =
          !!object &&
          object.size <= TRUSTED_SOURCE_MAX_FILE_SIZE &&
          isAllowedImageContentType(contentType);
        return { key, exists };
      }),
    );

    const valid = results.every((r) => r.exists);
    return { valid, results };
  }

  /**
   * Move images from temp to permanent location.
   *
   * @param moves - Array of { from, to } key pairs
   * @returns Move results for each operation
   */
  async move(
    moves: { from: string; to: string }[],
    ownerId?: string,
  ): Promise<MoveResponse> {
    const results = await Promise.all(
      moves.map(async ({ from, to }): Promise<MoveResult> => {
        try {
          // Validate source key is from temp/
          if (!from.startsWith("temp/")) {
            return {
              from,
              to,
              success: false,
              error: "Invalid source key: must be in temp/",
            };
          }

          if (
            ownerId &&
            !isOwnedTempKey(from, ownerId) &&
            !from.startsWith("temp/generated/")
          ) {
            return {
              from,
              to,
              success: false,
              error: "Invalid source key: upload does not belong to user",
            };
          }

          // Validate destination key
          if (!validateKey(to)) {
            return {
              from,
              to,
              success: false,
              error: "Invalid destination key",
            };
          }

          // Get the source object
          const source = await this.env.IMAGES.get(from);
          if (!source) {
            return { from, to, success: false, error: "Source not found" };
          }

          const contentType = source.httpMetadata?.contentType;
          if (!isAllowedImageContentType(contentType)) {
            return {
              from,
              to,
              success: false,
              error: "Invalid uploaded image content type",
            };
          }

          const maxFileSize = getMaxFileSizeForDestinationKey(to);
          if (source.size > maxFileSize) {
            return {
              from,
              to,
              success: false,
              error: `Image too large: ${source.size} bytes (max ${maxFileSize})`,
            };
          }

          // Copy to new location
          await this.env.IMAGES.put(to, source.body, {
            httpMetadata: source.httpMetadata,
            customMetadata: source.customMetadata,
          });

          // Delete source
          await this.env.IMAGES.delete(from);

          const asset = await buildStoredImageAsset(this.env, to);

          return { from, to, success: true, asset };
        } catch (error) {
          return {
            from,
            to,
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      }),
    );

    const success = results.every((r) => r.success);
    return { success, results };
  }

  /**
   * Delete images from storage.
   *
   * @param keys - Array of storage keys to delete
   */
  async delete(keys: string[]): Promise<void> {
    await Promise.all(keys.map((key) => this.env.IMAGES.delete(key)));
  }

  /**
   * Download an image from a URL and upload it to R2.
   * Used for re-hosting external images (e.g., from Instagram CDN).
   *
   * @param sourceUrl - The URL to download the image from
   * @param destinationKey - The R2 key to store the image at
   * @returns Upload result with public URL
   */
  async uploadFromUrl(
    sourceUrl: string,
    destinationKey: string,
  ): Promise<UploadFromUrlResponse> {
    try {
      // Validate destination key
      if (!validateKey(destinationKey)) {
        return {
          success: false,
          error: "Invalid destination key",
        };
      }

      const hostedSourceKey = imageKeyFromPublicUrl(
        sourceUrl,
        this.env.PUBLIC_URL,
      );
      if (hostedSourceKey) {
        const asset = await copyHostedImage(
          this.env,
          hostedSourceKey,
          destinationKey,
        );
        return {
          success: true,
          publicUrl: asset.publicUrl,
          key: asset.key,
          asset,
        };
      }

      // Fetch the image from the source URL once to validate redirects,
      // content type, and source size before Cloudflare performs resizing.
      let currentUrl = validateRemoteImageUrl(sourceUrl);
      let response: Response | null = null;
      for (
        let redirectCount = 0;
        redirectCount <= MAX_REMOTE_IMAGE_REDIRECTS;
        redirectCount++
      ) {
        response = await fetch(currentUrl.toString(), {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: IMAGE_ACCEPT_HEADER,
          },
          redirect: "manual",
        });

        if (
          response.status >= 300 &&
          response.status < 400 &&
          response.headers.has("location")
        ) {
          if (redirectCount === MAX_REMOTE_IMAGE_REDIRECTS) {
            return { success: false, error: "Too many image redirects" };
          }

          currentUrl = validateRemoteImageUrl(
            new URL(response.headers.get("location")!, currentUrl).toString(),
          );
          continue;
        }

        break;
      }

      if (!response) {
        return { success: false, error: "Failed to fetch image" };
      }

      if (!response.ok) {
        return {
          success: false,
          error: `Failed to fetch image: ${response.status} ${response.statusText}`,
        };
      }

      // Validate content type
      const contentType = response.headers.get("content-type");
      const mediaType = contentType?.toLowerCase().split(";")[0]?.trim();
      if (
        !mediaType ||
        !["image/jpeg", "image/png", "image/webp"].includes(mediaType)
      ) {
        return {
          success: false,
          error: `Invalid content type: ${contentType}`,
        };
      }

      // Check content length if available
      const contentLength = response.headers.get("content-length");
      if (
        contentLength &&
        parseInt(contentLength, 10) > TRUSTED_SOURCE_MAX_FILE_SIZE
      ) {
        return {
          success: false,
          error: `Image too large: ${contentLength} bytes (max ${TRUSTED_SOURCE_MAX_FILE_SIZE})`,
        };
      }

      const maxFileSize = getMaxFileSizeForDestinationKey(destinationKey);
      const imageData = await readNormalizedRemoteImage(
        currentUrl,
        maxFileSize,
      );

      // Upload to R2
      await this.env.IMAGES.put(destinationKey, imageData, {
        httpMetadata: {
          contentType: NORMALIZED_IMAGE_TYPE,
        },
      });

      const asset = await buildStoredImageAsset(this.env, destinationKey);

      return {
        success: true,
        publicUrl: asset.publicUrl,
        key: asset.key,
        asset,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Upload image bytes to a temporary R2 object.
   * Used by trusted service bindings for generated images.
   */
  async uploadImage(
    imageData: ArrayBuffer,
    contentType: ImageContentType,
    ownerId?: string,
  ): Promise<UploadImageResponse> {
    try {
      if (!isAllowedImageContentType(contentType)) {
        return {
          success: false,
          error: "Invalid content type",
        };
      }

      if (imageData.byteLength > TRUSTED_SOURCE_MAX_FILE_SIZE) {
        return {
          success: false,
          error: `Image too large: ${imageData.byteLength} bytes (max ${TRUSTED_SOURCE_MAX_FILE_SIZE})`,
        };
      }

      const key = ownerId
        ? generateUserTempKey(
            ownerId,
            extensionFromContentType(NORMALIZED_IMAGE_TYPE),
          )
        : generateGeneratedTempKey(
            extensionFromContentType(NORMALIZED_IMAGE_TYPE),
          );
      const rawKey = `${key}.source`;

      await this.env.IMAGES.put(rawKey, imageData, {
        httpMetadata: {
          contentType,
        },
      });

      try {
        await normalizeStoredObjectToJpeg(
          this.env,
          rawKey,
          key,
          PHOTO_MAX_FILE_SIZE,
        );
      } finally {
        await this.env.IMAGES.delete(rawKey);
      }

      const asset = await buildStoredImageAsset(this.env, key);

      return {
        success: true,
        publicUrl: asset.publicUrl,
        key: asset.key,
        asset,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}

/**
 * HTTP app for public image serving with transformations
 */
const app = new Hono<{ Bindings: Env }>();

// CORS for image requests
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    maxAge: 3600,
  }),
);

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

async function getOriginalImageResponse(
  env: Env,
  key: string,
  transformStatus: "original" | "origin" = "original",
): Promise<Response> {
  const object = await env.IMAGES.get(key);

  if (!object) {
    return Response.json({ error: "Image not found" }, { status: 404 });
  }

  const contentType =
    object.httpMetadata?.contentType || "application/octet-stream";

  return new Response(object.body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      [TRANSFORM_STATUS_HEADER]: transformStatus,
      ETag: object.etag,
    },
  });
}

/**
 * Serve images with optional transformations.
 * GET /{key}?preset=feed_720
 *
 * Preset transforms use the Cloudflare Images binding against R2 object bytes.
 * The origin-fetch branch remains for internal normalization requests.
 */
app.get("/*", async (c) => {
  const url = new URL(c.req.url);
  const key = url.pathname.slice(1); // Remove leading /

  if (!key || key === "health") {
    return c.json({ error: "Image key required" }, 400);
  }

  if (c.req.header(ORIGIN_FETCH_HEADER) === "1") {
    return getOriginalImageResponse(c.env, key, "origin");
  }

  if (hasUnsupportedTransformParams(url.searchParams)) {
    return c.json(
      { error: "Unsupported image transformation parameters" },
      400,
      {
        [TRANSFORM_STATUS_HEADER]: "unsupported",
        "Cache-Control": "no-store",
      },
    );
  }

  const transformRequested = hasTransformPreset(url.searchParams);
  const preset = parseTransformPreset(url.searchParams);

  if (transformRequested && !preset) {
    return c.json({ error: "Unsupported image transformation preset" }, 400, {
      [TRANSFORM_STATUS_HEADER]: "unsupported",
      "Cache-Control": "no-store",
    });
  }

  // If transformations requested, transform the R2 object bytes directly.
  if (preset) {
    const acceptHeader = c.req.header("Accept") ?? null;

    try {
      return await transformStoredImageWithBinding(
        c.env,
        key,
        preset,
        acceptHeader,
      );
    } catch (error) {
      console.log(
        JSON.stringify({
          event: "image_transform_failed",
          storageKey: key,
          preset,
          status: "exception",
          contentType: null,
          message: error instanceof Error ? error.message : "Unknown error",
        }),
      );

      return c.json(
        {
          error: "Image transformation failed",
          message: error instanceof Error ? error.message : "Unknown error",
        },
        502,
        {
          [TRANSFORM_STATUS_HEADER]: "failed",
          "Cache-Control": "no-store",
        },
      );
    }
  }

  // Serve original from R2 when no transformation was requested.
  return getOriginalImageResponse(c.env, key);
});

/**
 * Scheduled cleanup of orphaned temp images.
 * Runs daily at 3 AM UTC.
 */
const scheduled: ExportedHandlerScheduledHandler<Env> = async (
  _event,
  env,
  _ctx,
) => {
  const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
  const keysToDelete: string[] = [];

  // Paginate through all temp objects (R2 list returns max 1000 per call)
  let cursor: string | undefined;
  do {
    const listed = await env.IMAGES.list({ prefix: "temp/", cursor });

    for (const object of listed.objects) {
      if (object.uploaded.getTime() < twentyFourHoursAgo) {
        keysToDelete.push(object.key);
      }
    }

    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  if (keysToDelete.length > 0) {
    // Delete in batches of 100
    for (let i = 0; i < keysToDelete.length; i += 100) {
      const batch = keysToDelete.slice(i, i + 100);
      await Promise.all(batch.map((key) => env.IMAGES.delete(key)));
    }

    console.log(`Cleaned up ${keysToDelete.length} orphaned temp images`);
  }
};

export default {
  fetch: app.fetch,
  scheduled,
};
