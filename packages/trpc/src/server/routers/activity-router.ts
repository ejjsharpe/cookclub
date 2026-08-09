import type { PublicImageAsset } from "@repo/contracts/images";
import {
  activityEvents,
  activityLikes,
  cookingReviews,
  cookingReviewImages,
  recipes,
  user,
} from "@repo/db/schemas";
import {
  hydrateActivityIds,
  moveRecipeToCookedCollection,
  getBlockedUserIds,
} from "@repo/db/services";
import { TRPCError } from "@trpc/server";
import { type } from "arktype";
import { eq, desc, lt, and, sql, inArray, notInArray } from "drizzle-orm";

import { assertInteractionAllowed } from "./moderation-router";
import { filterOptionalPublicText } from "../moderation/text-filter";
import {
  propagateActivityToFollowers,
  hydrateFeed,
} from "../services/activity";
import { createAndSendNotificationInBackground } from "../services/push-notification.service";
import { cleanupMovedRecipeImages } from "../services/recipe-image.service";
import { router, authedProcedure, publicUgcProcedure } from "../trpc";
import { mapServiceError } from "../utils";

interface GetFeedIdsResponse {
  activityIds: number[];
  nextCursor: string | null;
}

function extensionFromKey(key: string) {
  return key.split(".").pop()?.toLowerCase() || "jpg";
}

function reviewImageInsertValues(
  reviewId: number,
  image: PublicImageAsset,
  index: number,
) {
  return {
    reviewId,
    url: image.url,
    storageKey: image.storageKey,
    width: image.width,
    height: image.height,
    contentType: image.contentType,
    byteSize: image.byteSize,
    thumbhash: image.thumbhash,
    index,
  };
}

export const activityRouter = router({
  getActivity: authedProcedure
    .input(
      type({
        activityEventId: "number",
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        const [activity] = await hydrateActivityIds(
          ctx.db,
          [input.activityEventId],
          ctx.user.id,
        );

        if (!activity) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Activity not found",
          });
        }

        return activity;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch activity",
        });
      }
    }),

  // Get the user's activity feed from their Durable Object
  getFeed: authedProcedure
    .input(
      type({
        cursor: "string?",
        limit: "number = 20",
      }),
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit } = input;

      try {
        const feedDO = ctx.env.USER_FEED.get(
          ctx.env.USER_FEED.idFromName(ctx.user.id),
        );

        const url = new URL("http://do/getFeedIds");
        if (cursor) url.searchParams.set("cursor", cursor);
        url.searchParams.set("limit", limit.toString());

        const response = await feedDO.fetch(new Request(url.toString()));
        let result = (await response.json()) as GetFeedIdsResponse;

        // Hydrate activity IDs into full FeedItems
        let items = await hydrateActivityIds(
          ctx.db,
          result.activityIds,
          ctx.user.id,
        );

        // Auto-hydrate on first page when the DO is empty, or when it contains
        // stale IDs from a local/dev database reset.
        if (
          !cursor &&
          (result.activityIds.length === 0 || items.length === 0)
        ) {
          await hydrateFeed(ctx.db, ctx.env, ctx.user.id);
          const hydratedResponse = await feedDO.fetch(
            new Request(url.toString()),
          );
          result = (await hydratedResponse.json()) as GetFeedIdsResponse;
          items = await hydrateActivityIds(
            ctx.db,
            result.activityIds,
            ctx.user.id,
          );
        }

        return {
          items,
          nextCursor: result.nextCursor,
        };
      } catch (err) {
        console.error("getFeed error:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch activity feed",
        });
      }
    }),

  // Create a cooking review (also creates activity event and fans out)
  createCookingReview: publicUgcProcedure
    .input(
      type({
        recipeId: "number",
        rating: "1 <= number <= 5",
        reviewText: "string?",
        imageUploadIds: "string[]?",
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { recipeId, rating, imageUploadIds } = input;
      const reviewText = filterOptionalPublicText(input.reviewText, "Review");
      let movedReviewImageKeys: string[] = [];
      let didPersistReview = false;

      try {
        const recipe = await ctx.db
          .select({
            id: recipes.id,
            name: recipes.name,
            ownerId: recipes.ownerId,
            moderationState: recipes.moderationState,
          })
          .from(recipes)
          .where(eq(recipes.id, recipeId))
          .then((rows) => rows[0]);

        if (!recipe || recipe.moderationState === "hidden") {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Recipe not found",
          });
        }
        await assertInteractionAllowed(ctx.db, ctx.user.id, recipe.ownerId);

        const reviewImages: PublicImageAsset[] = [];
        if (imageUploadIds && imageUploadIds.length > 0) {
          const groupId = crypto.randomUUID();
          const moves = imageUploadIds.map((uploadId) => ({
            from: uploadId,
            to: `reviews/${groupId}/${crypto.randomUUID()}.${extensionFromKey(uploadId)}`,
          }));

          const moveResult = await ctx.env.IMAGE_SERVICE.move(
            moves,
            ctx.user.id,
          );
          movedReviewImageKeys = moveResult.results
            .filter((result) => result.success)
            .map((result) => result.to);

          if (!moveResult.success) {
            const failedMoves = moveResult.results.filter(
              (result) => !result.success,
            );
            const message = failedMoves
              .map(
                (result) => `${result.from} -> ${result.to}: ${result.error}`,
              )
              .join(", ");
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: `Failed to move uploaded review images: ${message}`,
            });
          }

          for (const result of moveResult.results) {
            if (!result.asset) {
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: `Review image move did not return metadata for ${result.to}`,
              });
            }
            reviewImages.push(result.asset);
          }
        }

        const { activityEventId, createdAt, reviewId } =
          await ctx.db.transaction(async (tx) => {
            const now = new Date();

            // Create activity event
            const activityEventResult = await tx
              .insert(activityEvents)
              .values({
                userId: ctx.user.id,
                type: "cooking_review",
                recipeId,
                createdAt: now,
              })
              .returning();

            const activityEvent = activityEventResult[0];
            if (!activityEvent) {
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Failed to create activity event",
              });
            }

            // Create cooking review
            const reviewResult = await tx
              .insert(cookingReviews)
              .values({
                userId: ctx.user.id,
                recipeId,
                activityEventId: activityEvent.id,
                rating: Math.round(rating), // Ensure integer
                reviewText: reviewText ?? null,
                createdAt: now,
                updatedAt: now,
              })
              .returning();

            const review = reviewResult[0];
            if (!review) {
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Failed to create review",
              });
            }

            // Create review images if provided
            if (reviewImages.length > 0) {
              await tx
                .insert(cookingReviewImages)
                .values(
                  reviewImages.map((image, index) =>
                    reviewImageInsertValues(review.id, image, index),
                  ),
                );
            }

            await moveRecipeToCookedCollection(tx, {
              userId: ctx.user.id,
              recipeId,
              now,
            });

            return {
              activityEventId: activityEvent.id,
              createdAt: now,
              reviewId: review.id,
            };
          });
        didPersistReview = true;

        // Propagate to followers
        await propagateActivityToFollowers(
          ctx.db,
          ctx.env,
          activityEventId,
          ctx.user.id,
          createdAt,
        );

        return {
          id: reviewId,
          activityEventId,
        };
      } catch (err) {
        if (!didPersistReview) {
          await cleanupMovedRecipeImages(
            ctx.env.IMAGE_SERVICE,
            movedReviewImageKeys,
          );
        }
        throw mapServiceError(err);
      }
    }),

  // Get reviews for a specific recipe
  getRecipeReviews: authedProcedure
    .input(
      type({
        recipeId: "number",
        cursor: "number?",
        limit: "number = 20",
      }),
    )
    .query(async ({ ctx, input }) => {
      const { recipeId, cursor, limit } = input;

      try {
        const recipe = await ctx.db
          .select({
            ownerId: recipes.ownerId,
            moderationState: recipes.moderationState,
          })
          .from(recipes)
          .where(eq(recipes.id, recipeId))
          .then((rows) => rows[0]);
        if (
          !recipe ||
          (recipe.moderationState !== "visible" &&
            recipe.ownerId !== ctx.user.id)
        ) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        await assertInteractionAllowed(ctx.db, ctx.user.id, recipe.ownerId);

        // Build query with proper SQL cursor pagination
        const blockedUserIds = await getBlockedUserIds(ctx.db, ctx.user.id);
        const conditions = cursor
          ? and(
              eq(cookingReviews.recipeId, recipeId),
              lt(cookingReviews.id, cursor),
              eq(cookingReviews.moderationState, "visible"),
              ...(blockedUserIds.length > 0
                ? [notInArray(cookingReviews.userId, blockedUserIds)]
                : []),
            )
          : and(
              eq(cookingReviews.recipeId, recipeId),
              eq(cookingReviews.moderationState, "visible"),
              ...(blockedUserIds.length > 0
                ? [notInArray(cookingReviews.userId, blockedUserIds)]
                : []),
            );

        const results = await ctx.db
          .select({
            review: cookingReviews,
            user: {
              id: user.id,
              name: user.name,
              image: user.image,
            },
          })
          .from(cookingReviews)
          .innerJoin(user, eq(cookingReviews.userId, user.id))
          .where(conditions)
          .orderBy(desc(cookingReviews.id))
          .limit(limit + 1);

        // Check if there's a next page
        const hasMore = results.length > limit;
        const items = hasMore ? results.slice(0, limit) : results;

        // Batch fetch all images in one query (fixes N+1)
        const reviewIds = items.map((item) => item.review.id);
        const allImages =
          reviewIds.length > 0
            ? await ctx.db
                .select({
                  reviewId: cookingReviewImages.reviewId,
                  url: cookingReviewImages.url,
                  storageKey: cookingReviewImages.storageKey,
                  width: cookingReviewImages.width,
                  height: cookingReviewImages.height,
                  contentType: cookingReviewImages.contentType,
                  byteSize: cookingReviewImages.byteSize,
                  thumbhash: cookingReviewImages.thumbhash,
                })
                .from(cookingReviewImages)
                .where(inArray(cookingReviewImages.reviewId, reviewIds))
                .orderBy(
                  cookingReviewImages.reviewId,
                  cookingReviewImages.index,
                )
            : [];

        // Group images by reviewId
        const imagesByReview = new Map<number, typeof allImages>();
        for (const img of allImages) {
          const existing = imagesByReview.get(img.reviewId) ?? [];
          existing.push(img);
          imagesByReview.set(img.reviewId, existing);
        }

        // Map to results with images
        const reviewsWithImages = items.map((item) => ({
          id: item.review.id,
          rating: item.review.rating,
          reviewText: item.review.reviewText,
          images: (imagesByReview.get(item.review.id) ?? []).map((img) => ({
            url: img.url,
            storageKey: img.storageKey,
            width: img.width,
            height: img.height,
            contentType: img.contentType as PublicImageAsset["contentType"],
            byteSize: img.byteSize,
            thumbhash: img.thumbhash,
          })),
          createdAt: item.review.createdAt,
          user: item.user,
        }));

        const lastItem = items[items.length - 1];
        return {
          items: reviewsWithImages,
          nextCursor: hasMore && lastItem ? lastItem.review.id : null,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch recipe reviews",
        });
      }
    }),

  // Get the average rating for a recipe
  getRecipeRating: authedProcedure
    .input(
      type({
        recipeId: "number",
      }),
    )
    .query(async ({ ctx, input }) => {
      const { recipeId } = input;

      try {
        const recipe = await ctx.db
          .select({
            ownerId: recipes.ownerId,
            moderationState: recipes.moderationState,
          })
          .from(recipes)
          .where(eq(recipes.id, recipeId))
          .then((rows) => rows[0]);
        if (
          !recipe ||
          (recipe.moderationState !== "visible" &&
            recipe.ownerId !== ctx.user.id)
        ) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        await assertInteractionAllowed(ctx.db, ctx.user.id, recipe.ownerId);
        const blockedUserIds = await getBlockedUserIds(ctx.db, ctx.user.id);
        const reviews = await ctx.db
          .select({ rating: cookingReviews.rating })
          .from(cookingReviews)
          .where(
            and(
              eq(cookingReviews.recipeId, recipeId),
              eq(cookingReviews.moderationState, "visible"),
              ...(blockedUserIds.length > 0
                ? [notInArray(cookingReviews.userId, blockedUserIds)]
                : []),
            ),
          );

        if (reviews.length === 0) {
          return { averageRating: null, reviewCount: 0 };
        }

        const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
        const averageRating = sum / reviews.length;

        return {
          averageRating: Math.round(averageRating * 10) / 10, // Round to 1 decimal
          reviewCount: reviews.length,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch recipe rating",
        });
      }
    }),

  // Hydrate the user's feed from the database (useful for dev/seeding)
  hydrateFeed: authedProcedure.mutation(async ({ ctx }) => {
    try {
      const itemCount = await hydrateFeed(ctx.db, ctx.env, ctx.user.id);
      return { success: true, itemCount };
    } catch {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to hydrate feed",
      });
    }
  }),

  // Get activities for a specific user (for profile pages)
  getUserActivities: authedProcedure
    .input(
      type({
        userId: "string",
        cursor: "number?",
        limit: "number = 20",
      }),
    )
    .query(async ({ ctx, input }) => {
      const { userId, cursor, limit } = input;

      try {
        await assertInteractionAllowed(ctx.db, ctx.user.id, userId);
        // Build query conditions
        const conditions = cursor
          ? and(
              eq(activityEvents.userId, userId),
              lt(activityEvents.id, cursor),
              eq(activityEvents.moderationState, "visible"),
            )
          : and(
              eq(activityEvents.userId, userId),
              eq(activityEvents.moderationState, "visible"),
            );

        // Fetch activity events for the user
        const activities = await ctx.db
          .select({ id: activityEvents.id })
          .from(activityEvents)
          .where(conditions)
          .orderBy(desc(activityEvents.createdAt))
          .limit(limit + 1);

        // Check if there's a next page
        const hasMore = activities.length > limit;
        const activitySlice = hasMore ? activities.slice(0, limit) : activities;

        // Hydrate activity IDs into full FeedItems
        const activityIds = activitySlice.map((a) => a.id);
        const items = await hydrateActivityIds(
          ctx.db,
          activityIds,
          ctx.user.id,
        );

        // Get next cursor from the last item
        const lastActivity = activitySlice[activitySlice.length - 1];
        const nextCursor = hasMore && lastActivity ? lastActivity.id : null;

        return {
          items,
          nextCursor,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch user activities",
        });
      }
    }),

  // Toggle like on an activity (like/unlike)
  toggleLike: authedProcedure
    .input(
      type({
        activityEventId: "number",
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { activityEventId } = input;

      try {
        // Check if activity exists and get owner
        const activity = await ctx.db
          .select({
            id: activityEvents.id,
            userId: activityEvents.userId,
            likeCount: activityEvents.likeCount,
            moderationState: activityEvents.moderationState,
          })
          .from(activityEvents)
          .where(eq(activityEvents.id, activityEventId))
          .then((rows) => rows[0]);

        if (!activity || activity.moderationState !== "visible") {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Activity not found",
          });
        }
        await assertInteractionAllowed(ctx.db, ctx.user.id, activity.userId);

        // Check if user already liked
        const existingLike = await ctx.db
          .select({ id: activityLikes.id })
          .from(activityLikes)
          .where(
            and(
              eq(activityLikes.userId, ctx.user.id),
              eq(activityLikes.activityEventId, activityEventId),
            ),
          )
          .then((rows) => rows[0]);

        if (existingLike) {
          // Unlike - delete the like and decrement count
          await ctx.db
            .delete(activityLikes)
            .where(eq(activityLikes.id, existingLike.id));

          const updated = await ctx.db
            .update(activityEvents)
            .set({
              likeCount: sql`GREATEST(${activityEvents.likeCount} - 1, 0)`,
            })
            .where(eq(activityEvents.id, activityEventId))
            .returning({ likeCount: activityEvents.likeCount });

          return {
            liked: false,
            likeCount:
              updated[0]?.likeCount ?? Math.max(activity.likeCount - 1, 0),
          };
        } else {
          // Like - insert new like and increment count
          await ctx.db.insert(activityLikes).values({
            userId: ctx.user.id,
            activityEventId,
          });

          const updated = await ctx.db
            .update(activityEvents)
            .set({ likeCount: sql`${activityEvents.likeCount} + 1` })
            .where(eq(activityEvents.id, activityEventId))
            .returning({ likeCount: activityEvents.likeCount });

          // Create notification for the activity owner
          createAndSendNotificationInBackground(
            ctx,
            {
              recipientId: activity.userId,
              actorId: ctx.user.id,
              type: "activity_like",
              activityEventId,
            },
            "Error creating like notification:",
          );

          return {
            liked: true,
            likeCount: updated[0]?.likeCount ?? activity.likeCount + 1,
          };
        }
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to toggle like",
        });
      }
    }),
});
