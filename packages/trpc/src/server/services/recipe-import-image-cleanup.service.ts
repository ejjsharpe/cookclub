import type { ImageService } from "@repo/contracts/images";
import { recipeImportJobs } from "@repo/db/schemas";
import type { DbClient } from "@repo/db/services";
import { and, eq, inArray, lt, or } from "drizzle-orm";

const IMPORT_IMAGE_RECONCILIATION_BATCH_SIZE = 100;
export const RECIPE_IMPORT_JOB_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface RecipeImportImageCleanupResult {
  checked: number;
  deletedJobs: number;
  expiredJobs: number;
}

export async function cleanupRecipeImportImagesBestEffort(
  imageService: ImageService,
  jobId: string,
) {
  try {
    await imageService.deleteImportImages(jobId);
    return true;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "recipe_import_image_cleanup_failed",
        jobId,
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    return false;
  }
}

async function deleteImportImagePrefixes(
  imageService: ImageService,
  ids: string[],
) {
  if (ids.length === 0) return;

  await imageService.deleteImportImageStagingIds(ids);
}

async function deleteExpiredRecipeImportJobs(db: DbClient, now: Date) {
  const expiresBefore = new Date(
    now.getTime() - RECIPE_IMPORT_JOB_RETENTION_MS,
  );

  return await db
    .delete(recipeImportJobs)
    .where(
      and(
        or(
          eq(recipeImportJobs.status, "ready"),
          eq(recipeImportJobs.status, "failed"),
        ),
        lt(recipeImportJobs.updatedAt, expiresBefore),
      ),
    )
    .returning({ id: recipeImportJobs.id });
}

export async function cleanupOrphanedRecipeImportImages(
  db: DbClient,
  imageService: ImageService,
  now = new Date(),
): Promise<RecipeImportImageCleanupResult> {
  const expiredJobs = await deleteExpiredRecipeImportJobs(db, now);
  await deleteImportImagePrefixes(
    imageService,
    expiredJobs.map((job) => job.id),
  );

  const ids = await imageService.listImportImageStagingIds();
  const cleanupIds: string[] = [];
  let deletedJobs = 0;

  for (
    let offset = 0;
    offset < ids.length;
    offset += IMPORT_IMAGE_RECONCILIATION_BATCH_SIZE
  ) {
    const batch = ids.slice(
      offset,
      offset + IMPORT_IMAGE_RECONCILIATION_BATCH_SIZE,
    );
    const jobs = await db
      .select({
        id: recipeImportJobs.id,
        status: recipeImportJobs.status,
      })
      .from(recipeImportJobs)
      .where(inArray(recipeImportJobs.id, batch));
    const retainedIds = new Set(
      jobs.filter((job) => job.status !== "failed").map((job) => job.id),
    );
    const batchCleanupIds = batch.filter((id) => !retainedIds.has(id));

    cleanupIds.push(...batchCleanupIds);
    deletedJobs += batchCleanupIds.length;
  }

  await deleteImportImagePrefixes(imageService, cleanupIds);

  return {
    checked: ids.length,
    deletedJobs,
    expiredJobs: expiredJobs.length,
  };
}
