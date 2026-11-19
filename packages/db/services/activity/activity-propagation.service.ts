import type { PublicImageAsset } from "@repo/contracts/images";
import { inArray, and, eq } from "drizzle-orm";

import type { FeedItem, RecipeMetadata, SourceType } from "./feed-types";
import type { DbType } from "../../index";
import {
  activityEvents,
  activityLikes,
  cookingReviews,
  cookingReviewImages,
  user,
  recipes,
  recipeImages,
  recipeTags,
  tags,
} from "../../schemas";
import { getBlockedUserIds } from "../moderation";
import { publicSubscriptionTierSqlForUserTable } from "../subscription";

/**
 * Extract domain from a URL.
 */
function extractDomain(url: string | null): string | null {
  if (!url) return null;
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace("www.", "");
  } catch {
    return null;
  }
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

// ─── Hydration Functions (convert IDs to FeedItems) ──────────────────────────

/**
 * Hydrate activity IDs into full FeedItem objects.
 * This is the new read path - DO returns IDs, we hydrate from DB.
 */
export async function hydrateActivityIds(
  db: DbType,
  activityIds: number[],
  currentUserId: string,
): Promise<FeedItem[]> {
  if (activityIds.length === 0) return [];

  const blockedUserIds = new Set(
    currentUserId ? await getBlockedUserIds(db, currentUserId) : [],
  );

  // Batch fetch all activity events
  const activities = await db
    .select({
      id: activityEvents.id,
      type: activityEvents.type,
      userId: activityEvents.userId,
      recipeId: activityEvents.recipeId,
      likeCount: activityEvents.likeCount,
      commentCount: activityEvents.commentCount,
      createdAt: activityEvents.createdAt,
    })
    .from(activityEvents)
    .where(
      and(
        inArray(activityEvents.id, activityIds),
        eq(activityEvents.moderationState, "visible"),
      ),
    );

  if (activities.length === 0) return [];

  // Batch fetch recipes
  const recipeIds = [
    ...new Set(
      activities.filter((a) => a.recipeId).map((a) => a.recipeId as number),
    ),
  ];

  const recipesData =
    recipeIds.length > 0
      ? await db
          .select({
            id: recipes.id,
            ownerId: recipes.ownerId,
            name: recipes.name,
            sourceUrl: recipes.sourceUrl,
            sourceType: recipes.sourceType,
            originalOwnerId: recipes.originalOwnerId,
            prepTime: recipes.prepTime,
            cookTime: recipes.cookTime,
            totalTime: recipes.totalTime,
          })
          .from(recipes)
          .where(
            and(
              inArray(recipes.id, recipeIds),
              eq(recipes.moderationState, "visible"),
            ),
          )
      : [];
  const recipeMap = new Map(recipesData.map((r) => [r.id, r]));

  // Batch fetch activity actors and original recipe owners
  const userIds = [
    ...new Set([
      ...activities.map((activity) => activity.userId),
      ...recipesData.flatMap((recipe) =>
        recipe.originalOwnerId ? [recipe.originalOwnerId] : [],
      ),
    ]),
  ];
  const users = await db
    .select({
      id: user.id,
      name: user.name,
      username: user.username,
      image: user.image,
      banned: user.banned,
      subscriptionTier: publicSubscriptionTierSqlForUserTable(),
    })
    .from(user)
    .where(inArray(user.id, userIds));
  const userMap = new Map(users.map((u) => [u.id, u]));

  // Batch fetch recipe images (first image per recipe)
  const recipeImagesData =
    recipeIds.length > 0
      ? await db
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
          .orderBy(recipeImages.recipeId, recipeImages.index)
      : [];

  const recipeImageMap = new Map<number, PublicImageAsset>();
  for (const img of recipeImagesData) {
    if (!recipeImageMap.has(img.recipeId)) {
      recipeImageMap.set(img.recipeId, toPublicImageAsset(img));
    }
  }

  // Batch fetch tags (first two per recipe, in the order they were added)
  const FEED_TAG_LIMIT = 2;
  const tagRows =
    recipeIds.length > 0
      ? await db
          .select({ recipeId: recipeTags.recipeId, name: tags.name })
          .from(recipeTags)
          .innerJoin(tags, eq(recipeTags.tagId, tags.id))
          .where(inArray(recipeTags.recipeId, recipeIds))
          .orderBy(recipeTags.recipeId, recipeTags.id)
      : [];
  const recipeTagMap = new Map<number, string[]>();
  for (const row of tagRows) {
    const list = recipeTagMap.get(row.recipeId) ?? [];
    if (list.length < FEED_TAG_LIMIT) list.push(row.name);
    recipeTagMap.set(row.recipeId, list);
  }

  // Batch fetch cooking reviews for review activities
  const reviewActivityIds = activities
    .filter((a) => a.type === "cooking_review")
    .map((a) => a.id);

  const reviewsData =
    reviewActivityIds.length > 0
      ? await db
          .select({
            activityEventId: cookingReviews.activityEventId,
            id: cookingReviews.id,
            rating: cookingReviews.rating,
            reviewText: cookingReviews.reviewText,
          })
          .from(cookingReviews)
          .where(
            and(
              inArray(cookingReviews.activityEventId, reviewActivityIds),
              eq(cookingReviews.moderationState, "visible"),
            ),
          )
      : [];

  const reviewMap = new Map(
    reviewsData.map((r) => [r.activityEventId as number, r]),
  );

  // Batch fetch review images
  const reviewIds = reviewsData.map((r) => r.id);
  const reviewImagesData =
    reviewIds.length > 0
      ? await db
          .select({
            reviewId: cookingReviewImages.reviewId,
            url: cookingReviewImages.url,
            storageKey: cookingReviewImages.storageKey,
            width: cookingReviewImages.width,
            height: cookingReviewImages.height,
            contentType: cookingReviewImages.contentType,
            byteSize: cookingReviewImages.byteSize,
            thumbhash: cookingReviewImages.thumbhash,
            index: cookingReviewImages.index,
          })
          .from(cookingReviewImages)
          .where(inArray(cookingReviewImages.reviewId, reviewIds))
          .orderBy(cookingReviewImages.reviewId, cookingReviewImages.index)
      : [];

  const reviewImageMap = new Map<number, PublicImageAsset[]>();
  for (const img of reviewImagesData) {
    if (!reviewImageMap.has(img.reviewId)) {
      reviewImageMap.set(img.reviewId, []);
    }
    reviewImageMap.get(img.reviewId)!.push(toPublicImageAsset(img));
  }

  // Batch fetch like status for current user
  const likesData = await db
    .select({ activityEventId: activityLikes.activityEventId })
    .from(activityLikes)
    .where(
      and(
        inArray(activityLikes.activityEventId, activityIds),
        eq(activityLikes.userId, currentUserId),
      ),
    );
  const likedSet = new Set(likesData.map((l) => l.activityEventId));

  // Build feed items
  const feedItems: FeedItem[] = [];

  for (const activity of activities) {
    const actor = userMap.get(activity.userId);
    if (!actor || actor.banned || blockedUserIds.has(actor.id)) continue;

    if (!activity.recipeId) continue;
    const recipe = recipeMap.get(activity.recipeId);
    if (!recipe) continue;

    const recipeImage = recipeImageMap.get(recipe.id) ?? null;
    const summedTime = (recipe.prepTime ?? 0) + (recipe.cookTime ?? 0);
    const recipeExtras = {
      totalTime: recipe.totalTime ?? (summedTime > 0 ? summedTime : null),
      tags: recipeTagMap.get(recipe.id) ?? [],
    };

    // Build recipe metadata
    const sourceType = recipe.sourceType as SourceType;
    let recipeMetadata: RecipeMetadata;

    if (sourceType === "url" && recipe.sourceUrl) {
      const sourceDomain = extractDomain(recipe.sourceUrl);
      recipeMetadata = {
        id: recipe.id,
        ownerId: recipe.ownerId,
        name: recipe.name,
        image: recipeImage,
        ...recipeExtras,
        sourceType: "url",
        sourceUrl: recipe.sourceUrl,
        sourceDomain: sourceDomain ?? recipe.sourceUrl,
      };
    } else if (sourceType === "user") {
      const originalOwner = recipe.originalOwnerId
        ? userMap.get(recipe.originalOwnerId)
        : undefined;
      const publicOriginalOwner =
        originalOwner &&
        !originalOwner.banned &&
        !blockedUserIds.has(originalOwner.id)
          ? {
              id: originalOwner.id,
              name: originalOwner.name,
              username: originalOwner.username ?? null,
            }
          : null;

      recipeMetadata = {
        id: recipe.id,
        ownerId: recipe.ownerId,
        name: recipe.name,
        image: recipeImage,
        ...recipeExtras,
        sourceType: "user",
        originalOwner: publicOriginalOwner,
      };
    } else {
      recipeMetadata = {
        id: recipe.id,
        ownerId: recipe.ownerId,
        name: recipe.name,
        image: recipeImage,
        ...recipeExtras,
        sourceType: sourceType === "url" ? "manual" : sourceType,
      };
    }

    const baseItem = {
      id: activity.id.toString(),
      actor: {
        id: actor.id,
        name: actor.name,
        username: actor.username ?? null,
        image: actor.image ?? null,
        subscriptionTier: actor.subscriptionTier,
      },
      createdAt: activity.createdAt.getTime(),
      likeCount: activity.likeCount,
      commentCount: activity.commentCount,
      isLiked: likedSet.has(activity.id),
    };

    if (activity.type === "cooking_review") {
      const review = reviewMap.get(activity.id);
      if (!review) continue;

      const reviewImages = reviewImageMap.get(review.id) ?? [];

      feedItems.push({
        ...baseItem,
        type: "cooking_review",
        recipe: recipeMetadata,
        review: {
          rating: review.rating,
          text: review.reviewText,
          images: reviewImages,
        },
      });
    } else {
      feedItems.push({
        ...baseItem,
        type: "recipe_import",
        recipe: recipeMetadata,
      });
    }
  }

  // Sort by original order (activityIds array order for pagination consistency)
  const idOrder = new Map(activityIds.map((id, idx) => [id, idx]));
  feedItems.sort(
    (a, b) =>
      (idOrder.get(parseInt(a.id, 10)) ?? 0) -
      (idOrder.get(parseInt(b.id, 10)) ?? 0),
  );

  return feedItems;
}

// ─── Legacy buildFeedItem (kept for getUserActivities) ───────────────────────

/**
 * Build a single feed item from an activity event.
 * Used by getUserActivities which doesn't go through the DO.
 */
export async function buildFeedItem(
  db: DbType,
  activityEventId: number,
  currentUserId?: string,
): Promise<FeedItem | null> {
  const items = await hydrateActivityIds(
    db,
    [activityEventId],
    currentUserId ?? "",
  );
  return items[0] ?? null;
}
