import { activityEvents, comments, user } from "@repo/db/schemas";
import { getBlockedUserIds } from "@repo/db/services";
import { TRPCError } from "@trpc/server";
import { type } from "arktype";
import { and, asc, desc, eq, inArray, notInArray, or, sql } from "drizzle-orm";

import { assertInteractionAllowed } from "./moderation-router";
import { filterPublicText } from "../moderation/text-filter";
import {
  buildCommentThreads,
  type CommentListRow,
} from "../services/comment-list";
import { createAndSendNotificationInBackground } from "../services/push-notification.service";
import { router, authedProcedure, publicUgcProcedure } from "../trpc";

const MAX_COMMENTS_PER_ACTIVITY = 500;
const MAX_COMMENTS_PER_FOCUSED_THREAD = 500;
const MAX_COMMENT_LENGTH = 2_000;

const commentSelection = {
  id: comments.id,
  content: comments.content,
  parentCommentId: comments.parentCommentId,
  createdAt: comments.createdAt,
  user: {
    id: user.id,
    name: user.name,
    image: user.image,
  },
};

export const commentRouter = router({
  // Get all comments for an activity event
  getComments: authedProcedure
    .input(
      type({
        activityEventId: "number",
        "focusedCommentId?": "number",
      }),
    )
    .query(async ({ ctx, input }) => {
      const { activityEventId, focusedCommentId } = input;

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

        // Keep the most recent comments bounded, then restore any roots needed
        // to render those replies as complete threads.
        const blockedUserIds = await getBlockedUserIds(ctx.db, ctx.user.id);
        const visibleCommentConditions = [
          eq(comments.activityEventId, activityEventId),
          eq(comments.moderationState, "visible"),
          ...(blockedUserIds.length > 0
            ? [notInArray(comments.userId, blockedUserIds)]
            : []),
        ];
        const recentComments = (await ctx.db
          .select(commentSelection)
          .from(comments)
          .innerJoin(user, eq(comments.userId, user.id))
          .where(and(...visibleCommentConditions))
          .orderBy(desc(comments.createdAt))
          .limit(MAX_COMMENTS_PER_ACTIVITY)) as CommentListRow[];
        const recentCommentIds = new Set(
          recentComments.map((comment) => comment.id),
        );
        const missingRootIds = [
          ...new Set(
            recentComments.flatMap((comment) =>
              comment.parentCommentId !== null &&
              !recentCommentIds.has(comment.parentCommentId)
                ? [comment.parentCommentId]
                : [],
            ),
          ),
        ];
        const missingRoots =
          missingRootIds.length > 0
            ? ((await ctx.db
                .select(commentSelection)
                .from(comments)
                .innerJoin(user, eq(comments.userId, user.id))
                .where(
                  and(
                    ...visibleCommentConditions,
                    inArray(comments.id, missingRootIds),
                  ),
                )) as CommentListRow[])
            : [];
        const allComments = [...recentComments, ...missingRoots];

        let focusedCommentStatus: "found" | "unavailable" | null = null;
        let focusedThread: CommentListRow[] = [];

        if (focusedCommentId !== undefined) {
          const focusedComment = (await ctx.db
            .select(commentSelection)
            .from(comments)
            .innerJoin(user, eq(comments.userId, user.id))
            .where(
              and(
                ...visibleCommentConditions,
                eq(comments.id, focusedCommentId),
              ),
            )
            .then((rows) => rows[0])) as CommentListRow | undefined;

          if (focusedComment) {
            const rootCommentId =
              focusedComment.parentCommentId ?? focusedComment.id;
            focusedThread = (await ctx.db
              .select(commentSelection)
              .from(comments)
              .innerJoin(user, eq(comments.userId, user.id))
              .where(
                and(
                  ...visibleCommentConditions,
                  or(
                    eq(comments.id, rootCommentId),
                    eq(comments.parentCommentId, rootCommentId),
                  ),
                ),
              )
              .orderBy(asc(comments.createdAt))
              .limit(MAX_COMMENTS_PER_FOCUSED_THREAD)) as CommentListRow[];

            const rootIsAvailable = focusedThread.some(
              (comment) => comment.id === rootCommentId,
            );
            if (rootIsAvailable) {
              focusedCommentStatus = "found";
              if (
                !focusedThread.some(
                  (comment) => comment.id === focusedComment.id,
                )
              ) {
                focusedThread.push(focusedComment);
              }
            } else {
              focusedThread = [];
              focusedCommentStatus = "unavailable";
            }
          } else {
            focusedCommentStatus = "unavailable";
          }
        }

        return {
          comments: buildCommentThreads([...allComments, ...focusedThread]),
          focusedCommentStatus,
        };
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
        if (parentCommentId !== undefined) {
          const parentComment = await ctx.db
            .select({
              userId: comments.userId,
              activityEventId: comments.activityEventId,
              parentCommentId: comments.parentCommentId,
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
          if (parentComment.parentCommentId !== null) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Replies can only be added to top-level comments",
            });
          }
          parentCommentAuthorId = parentComment.userId;
          await assertInteractionAllowed(
            ctx.db,
            ctx.user.id,
            parentCommentAuthorId,
          );
        }

        const newComment = await ctx.db.transaction(async (tx) => {
          const [insertedComment] = await tx
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

          if (!insertedComment) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to create comment",
            });
          }

          // commentCount represents top-level discussion threads.
          if (parentCommentId === undefined) {
            await tx
              .update(activityEvents)
              .set({ commentCount: sql`${activityEvents.commentCount} + 1` })
              .where(eq(activityEvents.id, activityEventId));
          }

          return insertedComment;
        });

        // Create notifications
        if (newComment) {
          if (parentCommentId !== undefined && parentCommentAuthorId) {
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

        await ctx.db.transaction(async (tx) => {
          const [deletedComment] = await tx
            .delete(comments)
            .where(
              and(eq(comments.id, commentId), eq(comments.userId, ctx.user.id)),
            )
            .returning({ id: comments.id });

          if (!deletedComment) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Comment not found",
            });
          }

          // Deleting a root cascades to its replies, but removes one thread.
          if (comment.parentCommentId === null) {
            await tx
              .update(activityEvents)
              .set({
                commentCount: sql`GREATEST(${activityEvents.commentCount} - 1, 0)`,
              })
              .where(eq(activityEvents.id, comment.activityEventId));
          }
        });

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
