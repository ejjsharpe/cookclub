import type { PublicImageAsset } from "@repo/contracts/images";
import { eq, and, desc, sql, inArray } from "drizzle-orm";

import {
  recipes,
  recipeImages,
  recipeCollections,
  collections,
  recipeTags,
  tags,
  follows,
  user,
} from "../../schemas";
import type { DbClient } from "../types";

// ─── Types ─────────────────────────────────────────────────────────────────

type PublicRecipeTag = Pick<typeof tags.$inferSelect, "id" | "name">;

export type RecipeListItem = Omit<typeof recipes.$inferSelect, "ownerId"> & {
  owner: {
    id: string;
    name: string;
    username: string | null;
    image: string | null;
  };
  coverImage: PublicImageAsset | null;
  collectionIds: number[];
  isFollowing: boolean;
  tags: PublicRecipeTag[];
  relevanceScore: number;
};

// ─── Helper Functions ──────────────────────────────────────────────────────

/**
 * Group tags by recipe ID for batch assignment
 */
export function groupTagsByRecipeId(
  tagsData: { recipeId: number; tag: PublicRecipeTag | null }[],
): Record<number, PublicRecipeTag[]> {
  return tagsData.reduce(
    (acc, item) => {
      if (!acc[item.recipeId]) {
        acc[item.recipeId] = [];
      }
      if (item.tag) {
        acc[item.recipeId]!.push(item.tag);
      }
      return acc;
    },
    {} as Record<number, PublicRecipeTag[]>,
  );
}

/**
 * Group collection IDs by recipe ID for batch assignment
 */
export function groupCollectionsByRecipeId(
  collectionsData: { recipeId: number; collectionId: number }[],
): Record<number, number[]> {
  return collectionsData.reduce(
    (acc, item) => {
      if (!acc[item.recipeId]) {
        acc[item.recipeId] = [];
      }
      acc[item.recipeId]!.push(item.collectionId);
      return acc;
    },
    {} as Record<number, number[]>,
  );
}

function toPublicImageAsset(row: {
  url: string;
  storageKey: string;
  width: number;
  height: number;
  contentType: string;
  byteSize: number;
  thumbhash: string;
}): PublicImageAsset {
  return {
    url: row.url,
    storageKey: row.storageKey,
    width: row.width,
    height: row.height,
    contentType: row.contentType as PublicImageAsset["contentType"],
    byteSize: row.byteSize,
    thumbhash: row.thumbhash,
  };
}

// ─── Popular This Week Query ────────────────────────────────────────────────

/**
 * Get recipes with engagement (likes/saves) in the past 7 days
 * Returns a flat list ordered by recent engagement
 */
export async function queryPopularRecipesThisWeek(
  db: DbClient,
  userId: string,
  limit: number = 10,
): Promise<RecipeListItem[]> {
  const normalizedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  // Count recent engagement (saves within past 7 days)
  const recentEngagementExpr = sql<number>`
    COUNT(DISTINCT CASE WHEN ${recipeCollections.createdAt} >= ${sevenDaysAgo} THEN ${recipeCollections.id} END)
  `;

  // Build the query
  const queryResults = await db
    .select({
      recipe: recipes,
      uploader: {
        id: user.id,
        name: user.name,
        username: user.username,
        image: user.image,
      },
      recentEngagement: recentEngagementExpr,
      isFollowing: sql<boolean>`${follows.id} IS NOT NULL`,
    })
    .from(recipes)
    .innerJoin(user, eq(recipes.ownerId, user.id))
    .leftJoin(
      follows,
      and(
        eq(follows.followingId, recipes.ownerId),
        eq(follows.followerId, userId),
      ),
    )
    .groupBy(
      recipes.id,
      user.id,
      user.name,
      user.username,
      user.image,
      follows.id,
    )
    .having(sql`${recentEngagementExpr} > 0`)
    .orderBy(desc(recentEngagementExpr), desc(recipes.id))
    .limit(normalizedLimit);

  // Fetch related data
  const recipeIds = queryResults.map((item) => item.recipe.id);

  const [tagsData, collectionsData, imagesData] = await Promise.all([
    recipeIds.length > 0
      ? db
          .select({
            recipeId: recipeTags.recipeId,
            tag: {
              id: tags.id,
              name: tags.name,
            },
          })
          .from(recipeTags)
          .innerJoin(tags, eq(recipeTags.tagId, tags.id))
          .where(inArray(recipeTags.recipeId, recipeIds))
      : [],
    recipeIds.length > 0
      ? db
          .select({
            recipeId: recipeCollections.recipeId,
            collectionId: recipeCollections.collectionId,
          })
          .from(recipeCollections)
          .innerJoin(
            collections,
            eq(recipeCollections.collectionId, collections.id),
          )
          .where(
            and(
              inArray(recipeCollections.recipeId, recipeIds),
              eq(collections.userId, userId),
            ),
          )
      : [],
    recipeIds.length > 0
      ? db
          .select({
            recipeId: recipeImages.recipeId,
            url: recipeImages.url,
            storageKey: recipeImages.storageKey,
            width: recipeImages.width,
            height: recipeImages.height,
            contentType: recipeImages.contentType,
            byteSize: recipeImages.byteSize,
            thumbhash: recipeImages.thumbhash,
          })
          .from(recipeImages)
          .where(inArray(recipeImages.recipeId, recipeIds))
          .orderBy(recipeImages.recipeId, recipeImages.id)
      : [],
  ]);

  // Group related data
  const tagsByRecipe = groupTagsByRecipeId(tagsData);
  const collectionsByRecipe = groupCollectionsByRecipeId(collectionsData);
  const firstImageByRecipe = new Map<number, PublicImageAsset>();
  for (const image of imagesData) {
    if (!firstImageByRecipe.has(image.recipeId)) {
      firstImageByRecipe.set(image.recipeId, toPublicImageAsset(image));
    }
  }

  return queryResults.map((item) => ({
    ...item.recipe,
    owner: item.uploader,
    coverImage: firstImageByRecipe.get(item.recipe.id) ?? null,
    collectionIds: collectionsByRecipe[item.recipe.id] || [],
    isFollowing: item.isFollowing,
    tags: tagsByRecipe[item.recipe.id] || [],
    relevanceScore: Number(item.recentEngagement),
  }));
}
