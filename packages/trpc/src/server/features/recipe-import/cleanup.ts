import type { ImageService } from "@repo/contracts/images";
import {
  RECIPE_IMPORT_LIMITS,
  type RecipeImportStatus,
} from "@repo/contracts/recipe-import";
import { recipeImportJobs } from "@repo/db/schemas";
import type { DbClient } from "@repo/db/services";
import { and, eq, inArray, lt, or } from "drizzle-orm";

const RECONCILIATION_BATCH_SIZE = 100;

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

async function deleteImportPrefixes(imageService: ImageService, ids: string[]) {
  if (ids.length > 0) {
    await imageService.deleteImportImageStagingIds(ids);
  }
}

export async function cleanupOrphanedRecipeImportImages(
  db: DbClient,
  imageService: ImageService,
  now = new Date(),
): Promise<RecipeImportImageCleanupResult> {
  const expiresBefore = new Date(
    now.getTime() - RECIPE_IMPORT_LIMITS.terminalRetentionMs,
  );
  const expiredJobs = await db
    .delete(recipeImportJobs)
    .where(
      and(
        or(
          eq(recipeImportJobs.status, "ready"),
          eq(recipeImportJobs.status, "failed"),
          eq(recipeImportJobs.status, "consumed"),
        ),
        lt(recipeImportJobs.updatedAt, expiresBefore),
      ),
    )
    .returning({ id: recipeImportJobs.id });
  await deleteImportPrefixes(
    imageService,
    expiredJobs.map((job) => job.id),
  );

  const ids = await imageService.listImportImageStagingIds();
  const cleanupIds: string[] = [];
  const retainedStatuses = new Set<RecipeImportStatus>([
    "pending",
    "processing",
    "ready",
  ]);

  for (
    let offset = 0;
    offset < ids.length;
    offset += RECONCILIATION_BATCH_SIZE
  ) {
    const batch = ids.slice(offset, offset + RECONCILIATION_BATCH_SIZE);
    const jobs = await db
      .select({ id: recipeImportJobs.id, status: recipeImportJobs.status })
      .from(recipeImportJobs)
      .where(inArray(recipeImportJobs.id, batch));
    const retained = new Set(
      jobs
        .filter((job) => retainedStatuses.has(job.status as RecipeImportStatus))
        .map((job) => job.id),
    );
    cleanupIds.push(...batch.filter((id) => !retained.has(id)));
  }

  await deleteImportPrefixes(imageService, cleanupIds);
  return {
    checked: ids.length,
    deletedJobs: cleanupIds.length,
    expiredJobs: expiredJobs.length,
  };
}
