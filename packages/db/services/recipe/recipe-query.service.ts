import type { PublicImageAsset } from "@repo/contracts/images";
import { eq, and, desc, sql, inArray, notInArray } from "drizzle-orm";

import {
  recipes,
  recipeCollections,
  collections,
  tags,
  follows,
  user,
} from "../../schemas";
import { getBlockedUserIds } from "../moderation";
import type { DbClient } from "../types";
import {
  loadRecipeListRelations,
  normalizeRecipeListLimit,
} from "./recipe-list.service";

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

/** Group collection IDs by recipe ID for batch assignment. */
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
  const normalizedLimit = normalizeRecipeListLimit(limit);
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const blockedUserIds = await getBlockedUserIds(db, userId);

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
    .where(
      and(
        eq(recipes.moderationState, "visible"),
        ...(blockedUserIds.length > 0
          ? [notInArray(recipes.ownerId, blockedUserIds)]
          : []),
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

  const [relations, collectionsData] = await Promise.all([
    loadRecipeListRelations(db, recipeIds),
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
  ]);

  const collectionsByRecipe = groupCollectionsByRecipeId(collectionsData);

  return queryResults.map((item) => ({
    ...item.recipe,
    owner: item.uploader,
    coverImage: relations.coverImageByRecipe.get(item.recipe.id) ?? null,
    collectionIds: collectionsByRecipe[item.recipe.id] || [],
    isFollowing: item.isFollowing,
    tags: relations.tagsByRecipe.get(item.recipe.id) ?? [],
    relevanceScore: Number(item.recentEngagement),
  }));
}
