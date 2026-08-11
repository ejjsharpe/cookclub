import type { StoredImageAsset } from "@repo/contracts/images";
import { isValidImportImageStagingId } from "@repo/contracts/images";
import { RECIPE_IMPORT_LIMITS } from "@repo/contracts/recipe-import";

import { putAndInspectImage } from "./image-storage";
import { isOwnedTempKey } from "./presign";

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const NORMALIZED_CONTENT_TYPE = "image/jpeg";
const SOURCE_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type ImportSourceDependencies = {
  bucket: R2Bucket;
  normalize: (bytes: ArrayBuffer) => Promise<ArrayBuffer>;
  inspect: (key: string) => Promise<StoredImageAsset>;
};

function importSourceKey(jobId: string, sourceIndex: number) {
  if (
    !Number.isInteger(sourceIndex) ||
    sourceIndex < 0 ||
    sourceIndex >= RECIPE_IMPORT_LIMITS.sourceImages
  ) {
    throw new Error("Invalid import source index");
  }
  return `imports/${jobId}/${
    sourceIndex === 0 ? "source.jpg" : `source-${sourceIndex + 1}.jpg`
  }`;
}

async function deleteTempBestEffort(
  bucket: R2Bucket,
  tempKey: string,
  jobId: string,
) {
  try {
    await bucket.delete(tempKey);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "recipe_import_source_temp_cleanup_failed",
        jobId,
        sourceKey: tempKey,
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    );
  }
}

export async function stageImportSource(
  dependencies: ImportSourceDependencies,
  tempKey: string,
  ownerId: string,
  jobId: string,
  sourceIndex = 0,
  maxNormalizedBytes = MAX_SOURCE_BYTES,
): Promise<StoredImageAsset> {
  if (!isValidImportImageStagingId(jobId)) {
    throw new Error("Invalid import job id");
  }
  if (!isOwnedTempKey(tempKey, ownerId)) {
    throw new Error("Import source upload does not belong to user");
  }

  const destinationKey = importSourceKey(jobId, sourceIndex);
  const existing = await dependencies.bucket.head(destinationKey);
  if (existing) {
    if (
      existing.size > maxNormalizedBytes ||
      existing.httpMetadata?.contentType !== NORMALIZED_CONTENT_TYPE ||
      existing.customMetadata?.ownerId !== ownerId ||
      existing.customMetadata?.sourceTempKey !== tempKey
    ) {
      throw new Error("Existing import source is invalid");
    }
    const asset = await dependencies.inspect(destinationKey);
    await deleteTempBestEffort(dependencies.bucket, tempKey, jobId);
    return asset;
  }

  const source = await dependencies.bucket.get(tempKey);
  if (!source) throw new Error("Import source upload was not found");
  if (
    source.size > MAX_SOURCE_BYTES ||
    !SOURCE_CONTENT_TYPES.has(source.httpMetadata?.contentType ?? "")
  ) {
    throw new Error("Import source image is invalid");
  }

  const normalized = await dependencies.normalize(await source.arrayBuffer());
  if (normalized.byteLength > maxNormalizedBytes) {
    throw new Error("Import source image is too large after normalization");
  }
  const asset = await putAndInspectImage(
    dependencies.bucket,
    destinationKey,
    normalized,
    {
      httpMetadata: { contentType: NORMALIZED_CONTENT_TYPE },
      customMetadata: { ownerId, jobId, sourceTempKey: tempKey },
    },
    () => dependencies.inspect(destinationKey),
  );

  await deleteTempBestEffort(dependencies.bucket, tempKey, jobId);
  return asset;
}

export async function getImportSource(
  bucket: R2Bucket,
  jobId: string,
  sourceIndex = 0,
): Promise<Response> {
  if (!isValidImportImageStagingId(jobId)) {
    return Response.json({ error: "Invalid import job id" }, { status: 400 });
  }
  let sourceKey: string;
  try {
    sourceKey = importSourceKey(jobId, sourceIndex);
  } catch {
    return Response.json(
      { error: "Invalid import source index" },
      { status: 400 },
    );
  }
  const object = await bucket.get(sourceKey);
  if (!object) {
    return Response.json({ error: "Import source not found" }, { status: 404 });
  }
  if (
    object.size > MAX_SOURCE_BYTES ||
    object.httpMetadata?.contentType !== NORMALIZED_CONTENT_TYPE
  ) {
    return Response.json(
      { error: "Import source is invalid" },
      { status: 422 },
    );
  }
  return new Response(object.body, {
    headers: {
      "Content-Type": NORMALIZED_CONTENT_TYPE,
      "Content-Length": String(object.size),
      "Cache-Control": "private, no-store",
      ETag: object.etag,
    },
  });
}
