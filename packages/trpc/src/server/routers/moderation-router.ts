import {
  activityEvents,
  comments,
  contentReports,
  cookingReviews,
  follows,
  mealPlanInvitations,
  notifications,
  recipes,
  shoppingListInvitations,
  user,
  userBlocks,
  type ModerationTargetSnapshot,
  type ModerationTargetType,
} from "@repo/db/schemas";
import { areUsersBlocked } from "@repo/db/services";
import { TRPCError } from "@trpc/server";
import { type } from "arktype";
import { and, count, eq, gte, or } from "drizzle-orm";

import type { Context } from "../context";
import { PublicTRPCError } from "../public-errors";
import { removeUserFromFeed } from "../services/activity";
import { authedProcedure, router } from "../trpc";

const ReportTargetValidator = type(
  "'user' | 'comment' | 'activity' | 'recipe'",
);
const ReportReasonValidator = type(
  "'spam_scam' | 'harassment_hate' | 'sexual_content' | 'violence_danger' | 'child_safety' | 'intellectual_property' | 'other'",
);
const CreateReportValidator = type({
  targetType: ReportTargetValidator,
  targetId: "string",
  reason: ReportReasonValidator,
  "details?": "string",
});

function parseNumericTargetId(targetId: string): number {
  const parsed = Number(targetId);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new PublicTRPCError({
      code: "BAD_REQUEST",
      appCode: "INVALID_INPUT",
      message: "Choose valid content to report.",
    });
  }
  return parsed;
}

async function captureTargetSnapshot(
  ctx: Context & { user: NonNullable<Context["user"]> },
  targetType: ModerationTargetType,
  targetId: string,
): Promise<ModerationTargetSnapshot> {
  const capturedAt = new Date().toISOString();

  if (targetType === "user") {
    const [target] = await ctx.db
      .select({
        id: user.id,
        name: user.name,
        username: user.username,
        bio: user.bio,
        image: user.image,
        banned: user.banned,
      })
      .from(user)
      .where(eq(user.id, targetId))
      .limit(1);
    if (!target) throw new TRPCError({ code: "NOT_FOUND" });
    return {
      targetType,
      targetId,
      ownerUserId: target.id,
      capturedAt,
      content: target,
    };
  }

  const numericId = parseNumericTargetId(targetId);
  if (targetType === "comment") {
    const [target] = await ctx.db
      .select({
        id: comments.id,
        userId: comments.userId,
        activityEventId: comments.activityEventId,
        parentCommentId: comments.parentCommentId,
        content: comments.content,
        moderationState: comments.moderationState,
        createdAt: comments.createdAt,
      })
      .from(comments)
      .where(eq(comments.id, numericId))
      .limit(1);
    if (!target) throw new TRPCError({ code: "NOT_FOUND" });
    return {
      targetType,
      targetId,
      ownerUserId: target.userId,
      capturedAt,
      content: target,
    };
  }

  if (targetType === "recipe") {
    const [target] = await ctx.db
      .select({
        id: recipes.id,
        ownerId: recipes.ownerId,
        name: recipes.name,
        description: recipes.description,
        sourceType: recipes.sourceType,
        sourceUrl: recipes.sourceUrl,
        moderationState: recipes.moderationState,
        createdAt: recipes.createdAt,
      })
      .from(recipes)
      .where(eq(recipes.id, numericId))
      .limit(1);
    if (!target) throw new TRPCError({ code: "NOT_FOUND" });
    return {
      targetType,
      targetId,
      ownerUserId: target.ownerId,
      capturedAt,
      content: target,
    };
  }

  const [target] = await ctx.db
    .select({
      id: activityEvents.id,
      userId: activityEvents.userId,
      type: activityEvents.type,
      recipeId: activityEvents.recipeId,
      moderationState: activityEvents.moderationState,
      createdAt: activityEvents.createdAt,
      reviewId: cookingReviews.id,
      rating: cookingReviews.rating,
      reviewText: cookingReviews.reviewText,
    })
    .from(activityEvents)
    .leftJoin(
      cookingReviews,
      eq(cookingReviews.activityEventId, activityEvents.id),
    )
    .where(eq(activityEvents.id, numericId))
    .limit(1);
  if (!target) throw new TRPCError({ code: "NOT_FOUND" });
  return {
    targetType,
    targetId,
    ownerUserId: target.userId,
    capturedAt,
    content: target,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isUniqueViolation(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== "object") return false;
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function queueModerationAlert(
  ctx: Pick<Context, "env" | "waitUntil" | "requestId">,
  report: {
    id: number;
    targetType: string;
    targetId: string;
    reason: string;
    details: string | null;
  },
) {
  if (!ctx.env.EMAIL) return;
  const priority =
    report.reason === "child_safety" ? "URGENT CHILD SAFETY: " : "";
  const details = report.details ?? "No additional details provided.";
  const promise = ctx.env.EMAIL.send({
    to: "help@cookclub.app",
    from: { email: "moderation@cookclub.app", name: "cookclub Moderation" },
    subject: `${priority}New ${report.targetType} report #${report.id}`,
    text: `Report #${report.id}\nTarget: ${report.targetType} ${report.targetId}\nReason: ${report.reason}\nDetails: ${details}`,
    html: `<h1>New moderation report #${report.id}</h1><p><strong>Target:</strong> ${escapeHtml(report.targetType)} ${escapeHtml(report.targetId)}</p><p><strong>Reason:</strong> ${escapeHtml(report.reason)}</p><p><strong>Details:</strong> ${escapeHtml(details)}</p>`,
  }).catch((error) => {
    console.error(
      JSON.stringify({
        event: "moderation.report_alert_failed",
        reportId: report.id,
        requestId: ctx.requestId,
        error: error instanceof Error ? error.message : "Unknown email error",
      }),
    );
  });
  ctx.waitUntil(promise);
}

export const moderationRouter = router({
  createReport: authedProcedure
    .input(CreateReportValidator)
    .mutation(async ({ ctx, input }) => {
      const details = input.details?.trim() || null;
      if (details && details.length > 1_000) {
        throw new TRPCError({ code: "PAYLOAD_TOO_LARGE" });
      }

      const rateLimit = await ctx.env.MODERATION_RATE_LIMITER?.limit({
        key: ctx.user.id,
      });
      if (rateLimit && !rateLimit.success) {
        throw new PublicTRPCError({
          code: "TOO_MANY_REQUESTS",
          appCode: "RATE_LIMITED",
        });
      }

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1_000);
      const [recentCount] = await ctx.db
        .select({ count: count() })
        .from(contentReports)
        .where(
          and(
            eq(contentReports.reporterUserId, ctx.user.id),
            gte(contentReports.createdAt, oneHourAgo),
          ),
        );
      if ((recentCount?.count ?? 0) >= 10) {
        throw new PublicTRPCError({
          code: "TOO_MANY_REQUESTS",
          appCode: "RATE_LIMITED",
        });
      }

      const [duplicate] = await ctx.db
        .select({ id: contentReports.id })
        .from(contentReports)
        .where(
          and(
            eq(contentReports.reporterUserId, ctx.user.id),
            eq(contentReports.targetType, input.targetType),
            eq(contentReports.targetId, input.targetId),
            eq(contentReports.status, "open"),
          ),
        )
        .limit(1);
      if (duplicate) {
        throw new PublicTRPCError({
          code: "CONFLICT",
          appCode: "CONFLICT",
          message: "You have already reported this content.",
        });
      }

      const snapshot = await captureTargetSnapshot(
        ctx,
        input.targetType,
        input.targetId,
      );
      let report:
        | {
            id: number;
            targetType: string;
            targetId: string;
            reason: string;
            details: string | null;
            createdAt: Date;
          }
        | undefined;
      try {
        [report] = await ctx.db
          .insert(contentReports)
          .values({
            reporterUserId: ctx.user.id,
            targetType: input.targetType,
            targetId: input.targetId,
            targetOwnerUserId: snapshot.ownerUserId,
            reason: input.reason,
            details,
            targetSnapshot: snapshot,
            status: "open",
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning({
            id: contentReports.id,
            targetType: contentReports.targetType,
            targetId: contentReports.targetId,
            reason: contentReports.reason,
            details: contentReports.details,
            createdAt: contentReports.createdAt,
          });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new PublicTRPCError({
            code: "CONFLICT",
            appCode: "CONFLICT",
            message: "You have already reported this content.",
          });
        }
        throw error;
      }
      if (!report) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      queueModerationAlert(ctx, report);
      return report;
    }),

  blockUser: authedProcedure
    .input(type({ userId: "string" }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user.id) {
        throw new PublicTRPCError({
          code: "BAD_REQUEST",
          appCode: "INVALID_INPUT",
          message: "You cannot block yourself.",
        });
      }
      const [target] = await ctx.db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, input.userId))
        .limit(1);
      if (!target) throw new TRPCError({ code: "NOT_FOUND" });

      await ctx.db.transaction(async (tx) => {
        await tx
          .insert(userBlocks)
          .values({
            blockerUserId: ctx.user.id,
            blockedUserId: input.userId,
            createdAt: new Date(),
          })
          .onConflictDoNothing({
            target: [userBlocks.blockerUserId, userBlocks.blockedUserId],
          });
        await tx
          .delete(follows)
          .where(
            or(
              and(
                eq(follows.followerId, ctx.user.id),
                eq(follows.followingId, input.userId),
              ),
              and(
                eq(follows.followerId, input.userId),
                eq(follows.followingId, ctx.user.id),
              ),
            ),
          );
        await tx
          .delete(notifications)
          .where(
            or(
              and(
                eq(notifications.actorId, ctx.user.id),
                eq(notifications.recipientId, input.userId),
              ),
              and(
                eq(notifications.actorId, input.userId),
                eq(notifications.recipientId, ctx.user.id),
              ),
            ),
          );
        await tx
          .delete(mealPlanInvitations)
          .where(
            or(
              and(
                eq(mealPlanInvitations.invitedByUserId, ctx.user.id),
                eq(mealPlanInvitations.invitedUserId, input.userId),
              ),
              and(
                eq(mealPlanInvitations.invitedByUserId, input.userId),
                eq(mealPlanInvitations.invitedUserId, ctx.user.id),
              ),
            ),
          );
        await tx
          .delete(shoppingListInvitations)
          .where(
            or(
              and(
                eq(shoppingListInvitations.invitedByUserId, ctx.user.id),
                eq(shoppingListInvitations.invitedUserId, input.userId),
              ),
              and(
                eq(shoppingListInvitations.invitedByUserId, input.userId),
                eq(shoppingListInvitations.invitedUserId, ctx.user.id),
              ),
            ),
          );
      });

      await Promise.all([
        removeUserFromFeed(ctx.db, ctx.env, ctx.user.id, input.userId),
        removeUserFromFeed(ctx.db, ctx.env, input.userId, ctx.user.id),
      ]);
      return { success: true };
    }),

  unblockUser: authedProcedure
    .input(type({ userId: "string" }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(userBlocks)
        .where(
          and(
            eq(userBlocks.blockerUserId, ctx.user.id),
            eq(userBlocks.blockedUserId, input.userId),
          ),
        );
      return { success: true };
    }),

  listBlockedUsers: authedProcedure.query(async ({ ctx }) => {
    const blocks = await ctx.db
      .select({
        id: user.id,
        name: user.name,
        username: user.username,
        image: user.image,
        blockedAt: userBlocks.createdAt,
      })
      .from(userBlocks)
      .innerJoin(user, eq(user.id, userBlocks.blockedUserId))
      .where(eq(userBlocks.blockerUserId, ctx.user.id));
    return blocks;
  }),
});

export async function assertInteractionAllowed(
  db: Parameters<typeof areUsersBlocked>[0],
  firstUserId: string,
  secondUserId: string,
) {
  if (await areUsersBlocked(db, firstUserId, secondUserId)) {
    throw new PublicTRPCError({
      code: "FORBIDDEN",
      appCode: "ACCESS_DENIED",
      message: "This interaction is not available.",
    });
  }
}
