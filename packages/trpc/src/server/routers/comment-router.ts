import { activityEvents, comments, user } from "@repo/db/schemas";
import { getBlockedUserIds } from "@repo/db/services";
import { TRPCError } from "@trpc/server";
import { type } from "arktype";
import { and, asc, eq, notInArray, sql } from "drizzle-orm";

import { assertInteractionAllowed } from "./moderation-router";
import { filterPublicText } from "../moderation/text-filter";
import { createAndSendNotificationInBackground } from "../services/push-notification.service";
import { router, authedProcedure, publicUgcProcedure } from "../trpc";

const MAX_COMMENTS_PER_ACTIVITY = 500;
const MAX_COMMENT_LENGTH = 2_000;

export const commentRouter = router({
  // Get all comments for an activity event
  getComments: authedProcedure
    .input(
      type({
        activityEventId: "number",
      }),
    )
    .query(async ({ ctx, input }) => {
      const { activityEventId } = input;

      try {
        const activity = await ctx.db
          .select({
            userId: activityEvents.userId,
            moderationState: activityEvents.moderationState,
          })
          .from(activityEvents)
          .where(eq(activityEvents.id, activityEventId))
          .then((rows) => rows[0]);
        if (!activity || activity.moderationState !== "visible") {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        await assertInteractionAllowed(ctx.db, ctx.user.id, activity.userId);

        // Fetch all comments with user info
        const blockedUserIds = await getBlockedUserIds(ctx.db, ctx.user.id);
        const allComments = await ctx.db
          .select({
            id: comments.id,
            content: comments.content,
            parentCommentId: comments.parentCommentId,
            createdAt: comments.createdAt,
            user: {
              id: user.id,
              name: user.name,
              image: user.image,
            },
          })
          .from(comments)
          .innerJoin(user, eq(comments.userId, user.id))
          .where(
            and(
              eq(comments.activityEventId, activityEventId),
              eq(comments.moderationState, "visible"),
              ...(blockedUserIds.length > 0
                ? [notInArray(comments.userId, blockedUserIds)]
                : []),
            ),
          )
          .orderBy(asc(comments.createdAt))
          .limit(MAX_COMMENTS_PER_ACTIVITY);

        // Group comments: top-level and replies
        const topLevelComments = allComments.filter(
          (c) => c.parentCommentId === null,
        );
        const replies = allComments.filter((c) => c.parentCommentId !== null);

        // Build nested structure
        const commentsWithReplies = topLevelComments.map((comment) => ({
          ...comment,
          replies: replies.filter((r) => r.parentCommentId === comment.id),
        }));

        return commentsWithReplies;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch comments",
        });
      }
    }),

  // Create a new comment
  createComment: publicUgcProcedure
    .input(
      type({
        activityEventId: "number",
        "parentCommentId?": "number",
        content: "string",
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { activityEventId, parentCommentId } = input;
      const content = filterPublicText(input.content, "Comment");

      if (content.trim().length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Comment cannot be empty",
        });
      }
      if (content.length > MAX_COMMENT_LENGTH) {
        throw new TRPCError({
          code: "PAYLOAD_TOO_LARGE",
          message: "Comment is too large",
        });
      }

      try {
        const now = new Date();

        // Fetch activity owner for notifications
        const activity = await ctx.db
          .select({
            userId: activityEvents.userId,
            moderationState: activityEvents.moderationState,
          })
          .from(activityEvents)
          .where(eq(activityEvents.id, activityEventId))
          .then((rows) => rows[0]);

        if (!activity || activity.moderationState !== "visible") {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        await assertInteractionAllowed(ctx.db, ctx.user.id, activity.userId);

        // Fetch parent comment author if this is a reply
        let parentCommentAuthorId: string | null = null;
        if (parentCommentId) {
          const parentComment = await ctx.db
            .select({
              userId: comments.userId,
              activityEventId: comments.activityEventId,
              moderationState: comments.moderationState,
            })
            .from(comments)
            .where(eq(comments.id, parentCommentId))
            .then((rows) => rows[0]);
          if (
            !parentComment ||
            parentComment.activityEventId !== activityEventId ||
            parentComment.moderationState !== "visible"
          ) {
            throw new TRPCError({ code: "NOT_FOUND" });
          }
          parentCommentAuthorId = parentComment.userId;
          await assertInteractionAllowed(
            ctx.db,
            ctx.user.id,
            parentCommentAuthorId,
          );
        }

        const [newComment] = await ctx.db
          .insert(comments)
          .values({
            userId: ctx.user.id,
            activityEventId,
            parentCommentId: parentCommentId ?? null,
            content: content.trim(),
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        // Increment commentCount on activity_events only for top-level comments
        if (!parentCommentId) {
          await ctx.db
            .update(activityEvents)
            .set({ commentCount: sql`${activityEvents.commentCount} + 1` })
            .where(eq(activityEvents.id, activityEventId));
        }

        // Create notifications
        if (newComment) {
          if (parentCommentId && parentCommentAuthorId) {
            // Reply notification to the parent comment author
            createAndSendNotificationInBackground(
              ctx,
              {
                recipientId: parentCommentAuthorId,
                actorId: ctx.user.id,
                type: "comment_reply",
                activityEventId,
                commentId: newComment.id,
              },
              "Error creating comment reply notification:",
            );
          } else if (activity) {
            // Comment notification to the activity owner
            createAndSendNotificationInBackground(
              ctx,
              {
                recipientId: activity.userId,
                actorId: ctx.user.id,
                type: "activity_comment",
                activityEventId,
                commentId: newComment.id,
              },
              "Error creating comment notification:",
            );
          }
        }

        return {
          ...newComment,
          user: {
            id: ctx.user.id,
            name: ctx.user.name,
            image: ctx.user.image,
          },
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create comment",
        });
      }
    }),

  // Delete a comment (only own comments)
  deleteComment: authedProcedure
    .input(
      type({
        commentId: "number",
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { commentId } = input;

      try {
        // Check if comment exists and belongs to user
        const [comment] = await ctx.db
          .select()
          .from(comments)
          .where(eq(comments.id, commentId));

        if (!comment) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Comment not found",
          });
        }

        if (comment.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You can only delete your own comments",
          });
        }

        // Delete comment (cascades to replies)
        await ctx.db.delete(comments).where(eq(comments.id, commentId));

        // Decrement commentCount on activity_events only for top-level comments
        if (comment.parentCommentId === null) {
          await ctx.db
            .update(activityEvents)
            .set({
              commentCount: sql`GREATEST(${activityEvents.commentCount} - 1, 0)`,
            })
            .where(eq(activityEvents.id, comment.activityEventId));
        }

        return { success: true };
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete comment",
        });
      }
    }),
});
