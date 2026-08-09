import { follows, user } from "@repo/db/schemas";
import {
  followUser as followUserService,
  unfollowUser as unfollowUserService,
  getFollowList,
  areUsersBlocked,
  getBlockedUserIds,
  publicSubscriptionTierSqlForUserTable,
} from "@repo/db/services";
import { TRPCError } from "@trpc/server";
import { type } from "arktype";
import {
  eq,
  and,
  or,
  ne,
  like,
  sql,
  notInArray,
  desc,
  isNotNull,
} from "drizzle-orm";

import { backfillFeedFromUser, removeUserFromFeed } from "../services/activity";
import { createAndSendNotificationInBackground } from "../services/push-notification.service";
import { router, authedProcedure } from "../trpc";
import { mapServiceError } from "../utils";

const MAX_USER_SEARCH_LIMIT = 50;
const MAX_USER_SEARCH_QUERY_LENGTH = 100;

function normalizeUserSearchLimit(limit: number) {
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_USER_SEARCH_LIMIT);
}

export const followsRouter = router({
  // Follow a user
  followUser: authedProcedure
    .input(
      type({
        userId: "string",
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await followUserService(
          ctx.db,
          ctx.user.id,
          input.userId,
        );

        // Create notification for the followed user
        createAndSendNotificationInBackground(
          ctx,
          {
            recipientId: input.userId,
            actorId: ctx.user.id,
            type: "follow",
          },
          "Error creating follow notification:",
        );

        // The client refreshes its feed when this mutation resolves, so finish
        // the current user's feed update before returning the response.
        try {
          await backfillFeedFromUser(
            ctx.db,
            ctx.env,
            ctx.user.id,
            input.userId,
            10,
          );
        } catch (err) {
          console.error("Error backfilling feed:", err);
        }

        return result;
      } catch (err) {
        throw mapServiceError(err);
      }
    }),

  // Unfollow a user
  unfollowUser: authedProcedure
    .input(
      type({
        userId: "string",
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await unfollowUserService(
          ctx.db,
          ctx.user.id,
          input.userId,
        );

        // Keep feed state in sync before the client invalidates its cache.
        try {
          await removeUserFromFeed(ctx.db, ctx.env, ctx.user.id, input.userId);
        } catch (err) {
          console.error("Error removing user from feed:", err);
        }

        return result;
      } catch (err) {
        throw mapServiceError(err);
      }
    }),

  // Get users I'm following
  getFollowing: authedProcedure.query(async ({ ctx }) => {
    try {
      return await getFollowList(ctx.db, {
        userId: ctx.user.id,
        type: "following",
      });
    } catch {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch following list",
      });
    }
  }),

  // Get my followers
  getFollowers: authedProcedure.query(async ({ ctx }) => {
    try {
      return await getFollowList(ctx.db, {
        userId: ctx.user.id,
        type: "followers",
      });
    } catch {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch followers list",
      });
    }
  }),

  // Search for users to follow
  searchUsers: authedProcedure
    .input(
      type({
        query: "string",
        limit: "number = 10",
      }),
    )
    .query(async ({ ctx, input }) => {
      const query = input.query.trim();
      const limit = normalizeUserSearchLimit(input.limit);

      if (query.length < 2) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Search query must be at least 2 characters",
        });
      }
      if (query.length > MAX_USER_SEARCH_QUERY_LENGTH) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Search query is too long",
        });
      }

      try {
        const blockedUserIds = await getBlockedUserIds(ctx.db, ctx.user.id);
        const users = await ctx.db
          .select({
            id: user.id,
            name: user.name,
            username: user.username,
            image: user.image,
            subscriptionTier: publicSubscriptionTierSqlForUserTable(),
          })
          .from(user)
          .where(
            and(
              ne(user.id, ctx.user.id),
              eq(user.emailVerified, true),
              isNotNull(user.username),
              ...(blockedUserIds.length > 0
                ? [notInArray(user.id, blockedUserIds)]
                : []),
              or(
                like(user.name, `%${query}%`),
                like(user.username, `%${query}%`),
              ),
            ),
          )
          .limit(limit);

        return users;
      } catch {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to search users",
        });
      }
    }),

  // Get suggested users to follow (ordered by follower count)
  getSuggestedUsers: authedProcedure
    .input(
      type({
        limit: "number = 10",
      }),
    )
    .query(async ({ ctx, input }) => {
      const limit = normalizeUserSearchLimit(input.limit);

      try {
        const blockedUserIds = await getBlockedUserIds(ctx.db, ctx.user.id);
        // Get IDs of users the current user already follows
        const followedIds = ctx.db
          .select({ id: follows.followingId })
          .from(follows)
          .where(eq(follows.followerId, ctx.user.id));

        const suggestedUsers = await ctx.db
          .select({
            id: user.id,
            name: user.name,
            username: user.username,
            image: user.image,
            subscriptionTier: publicSubscriptionTierSqlForUserTable(),
            recipeCount: sql<number>`(
              SELECT COUNT(*)::int FROM recipes WHERE owner_id = "user"."id"
            )`,
            followerCount: sql<number>`(
              SELECT COUNT(*)::int FROM follows WHERE following_id = "user"."id"
            )`,
          })
          .from(user)
          .where(
            and(
              ne(user.id, ctx.user.id),
              eq(user.emailVerified, true),
              isNotNull(user.username),
              notInArray(user.id, followedIds),
              ...(blockedUserIds.length > 0
                ? [notInArray(user.id, blockedUserIds)]
                : []),
            ),
          )
          .orderBy(
            desc(
              sql`(SELECT COUNT(*) FROM follows WHERE following_id = "user"."id")`,
            ),
          )
          .limit(limit);

        return suggestedUsers;
      } catch {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch suggested users",
        });
      }
    }),

  // Get user profile with follow status
  getUserProfile: authedProcedure
    .input(
      type({
        userId: "string",
      }),
    )
    .query(async ({ ctx, input }) => {
      const { userId } = input;
      const currentUserId = ctx.user.id;

      try {
        if (await areUsersBlocked(ctx.db, currentUserId, userId)) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        // Single query with subqueries for all profile data
        // Note: We use "user"."id" explicitly in subqueries because Drizzle's ${user.id}
        // emits just "id" which would resolve to the subquery's table (e.g., follows.id)
        const profileData = await ctx.db
          .select({
            id: user.id,
            name: user.name,
            username: user.username,
            image: user.image,
            createdAt: user.createdAt,
            subscriptionTier: publicSubscriptionTierSqlForUserTable(),
            followersCount: sql<number>`(
              SELECT COUNT(*)::int FROM follows WHERE following_id = "user"."id"
            )`,
            followingCount: sql<number>`(
              SELECT COUNT(*)::int FROM follows WHERE follower_id = "user"."id"
            )`,
            recipeCount: sql<number>`(
              SELECT COUNT(*)::int FROM recipes WHERE owner_id = "user"."id"
            )`,
            isFollowing: sql<boolean>`EXISTS(
              SELECT 1 FROM follows
              WHERE follower_id = ${currentUserId} AND following_id = "user"."id"
            )`,
            followsMe: sql<boolean>`EXISTS(
              SELECT 1 FROM follows
              WHERE follower_id = "user"."id" AND following_id = ${currentUserId}
            )`,
          })
          .from(user)
          .where(eq(user.id, userId))
          .then((rows) => rows[0]);

        if (!profileData) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "User not found",
          });
        }

        return {
          user: {
            id: profileData.id,
            name: profileData.name,
            username: profileData.username,
            image: profileData.image,
            createdAt: profileData.createdAt,
            subscriptionTier: profileData.subscriptionTier,
          },
          isFollowing: profileData.isFollowing,
          followsMe: profileData.followsMe,
          followersCount: profileData.followersCount,
          followingCount: profileData.followingCount,
          recipeCount: profileData.recipeCount,
        };
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch user profile",
        });
      }
    }),

  // Get a specific user's followers
  getUserFollowers: authedProcedure
    .input(
      type({
        userId: "string",
      }),
    )
    .query(async ({ ctx, input }) => {
      const { userId } = input;

      try {
        if (await areUsersBlocked(ctx.db, ctx.user.id, userId)) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        const blockedUserIds = await getBlockedUserIds(ctx.db, ctx.user.id);
        const followersList = await ctx.db
          .select({
            follow: follows,
            user,
            subscriptionTier: publicSubscriptionTierSqlForUserTable(),
          })
          .from(follows)
          .innerJoin(user, eq(follows.followerId, user.id))
          .where(
            and(
              eq(follows.followingId, userId),
              ...(blockedUserIds.length > 0
                ? [notInArray(user.id, blockedUserIds)]
                : []),
            ),
          );

        return followersList.map((item) => ({
          followId: item.follow.id,
          user: {
            id: item.user.id,
            name: item.user.name,
            username: item.user.username,
            image: item.user.image,
            subscriptionTier: item.subscriptionTier,
          },
          followedAt: item.follow.createdAt,
        }));
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch user followers list",
        });
      }
    }),

  // Get a specific user's following
  getUserFollowing: authedProcedure
    .input(
      type({
        userId: "string",
      }),
    )
    .query(async ({ ctx, input }) => {
      const { userId } = input;

      try {
        if (await areUsersBlocked(ctx.db, ctx.user.id, userId)) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        const blockedUserIds = await getBlockedUserIds(ctx.db, ctx.user.id);
        const followingList = await ctx.db
          .select({
            follow: follows,
            user,
            subscriptionTier: publicSubscriptionTierSqlForUserTable(),
          })
          .from(follows)
          .innerJoin(user, eq(follows.followingId, user.id))
          .where(
            and(
              eq(follows.followerId, userId),
              ...(blockedUserIds.length > 0
                ? [notInArray(user.id, blockedUserIds)]
                : []),
            ),
          );

        return followingList.map((item) => ({
          followId: item.follow.id,
          user: {
            id: item.user.id,
            name: item.user.name,
            username: item.user.username,
            image: item.user.image,
            subscriptionTier: item.subscriptionTier,
          },
          followedAt: item.follow.createdAt,
        }));
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch user following list",
        });
      }
    }),
});
