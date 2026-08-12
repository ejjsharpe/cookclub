import { eq, and, desc, lt, sql, inArray } from "drizzle-orm";

import {
  comments,
  notifications,
  user,
  type NotificationType,
} from "../../schemas";
import { areUsersBlocked } from "../moderation";
import type { DbClient } from "../types";

const COMMENT_PREVIEW_MAX_LENGTH = 120;
const commentPreviewSource = sql<string | null>`nullif(
  left(
    btrim(regexp_replace(${comments.content}, '[[:space:]]+', ' ', 'g')),
    ${COMMENT_PREVIEW_MAX_LENGTH + 1}
  ),
  ''
)`;

export function formatCommentPreview(source: string | null): string | null {
  if (!source) return null;
  const characters = Array.from(source);
  if (characters.length <= COMMENT_PREVIEW_MAX_LENGTH) return source;
  return `${characters
    .slice(0, COMMENT_PREVIEW_MAX_LENGTH - 1)
    .join("")
    .trimEnd()}…`;
}

export function getNotificationActorName(actor: {
  name: string;
  username: string | null;
}): string | null {
  const name = actor.name.trim();
  if (name) return name;
  return actor.username ? `@${actor.username}` : null;
}

// ─── Types ─────────────────────────────────────────────────────────────────

export type NotificationItem = {
  id: number;
  type: NotificationType;
  actorId: string;
  actorName: string;
  actorImage: string | null;
  activityEventId: number | null;
  mealPlanId: number | null;
  shoppingListId: number | null;
  commentId: number | null;
  commentPreview: string | null;
  isRead: boolean;
  createdAt: Date;
};

type CreateNotificationBase = {
  recipientId: string;
  actorId: string;
};

export type CreateNotificationParams = CreateNotificationBase &
  (
    | {
        type: "follow";
        activityEventId?: never;
        mealPlanId?: never;
        shoppingListId?: never;
        commentId?: never;
      }
    | {
        type: "activity_like";
        activityEventId: number;
        mealPlanId?: never;
        shoppingListId?: never;
        commentId?: never;
      }
    | {
        type: "activity_comment" | "comment_reply";
        activityEventId: number;
        commentId: number;
        mealPlanId?: never;
        shoppingListId?: never;
      }
    | {
        type: "meal_plan_share" | "meal_plan_invite";
        mealPlanId: number;
        activityEventId?: never;
        shoppingListId?: never;
        commentId?: never;
      }
    | {
        type: "shopping_list_invite";
        shoppingListId: number;
        activityEventId?: never;
        mealPlanId?: never;
        commentId?: never;
      }
  );

// ─── Notification Operations ─────────────────────────────────────────────────

/**
 * Create a notification
 * Skips self-notifications (when actor === recipient)
 * Fetches actor info for denormalization
 */
export async function createNotification(
  db: DbClient,
  params: CreateNotificationParams,
): Promise<NotificationItem | null> {
  const {
    recipientId,
    actorId,
    type,
    activityEventId,
    mealPlanId,
    shoppingListId,
    commentId,
  } = params;

  // Skip self-notifications
  if (recipientId === actorId) {
    return null;
  }

  if (await areUsersBlocked(db, recipientId, actorId)) {
    return null;
  }

  // Fetch actor info for denormalization
  const actor = await db
    .select({
      name: user.name,
      username: user.username,
      image: user.image,
    })
    .from(user)
    .where(eq(user.id, actorId))
    .then((rows) => rows[0]);

  if (!actor) {
    return null;
  }

  const actorName = getNotificationActorName(actor);
  if (!actorName) {
    return null;
  }

  const commentPreview =
    type === "activity_comment" || type === "comment_reply"
      ? await db
          .select({ source: commentPreviewSource })
          .from(comments)
          .where(
            and(
              eq(comments.id, params.commentId),
              eq(comments.activityEventId, params.activityEventId),
              eq(comments.moderationState, "visible"),
            ),
          )
          .then((rows) => formatCommentPreview(rows[0]?.source ?? null))
      : null;

  if (
    (type === "activity_comment" || type === "comment_reply") &&
    !commentPreview
  ) {
    return null;
  }

  const now = new Date();

  const [notification] = await db
    .insert(notifications)
    .values({
      recipientId,
      actorId,
      type,
      activityEventId: activityEventId ?? null,
      mealPlanId: mealPlanId ?? null,
      shoppingListId: shoppingListId ?? null,
      commentId: commentId ?? null,
      actorName,
      actorImage: actor.image,
      isRead: false,
      createdAt: now,
    })
    .returning();

  if (!notification) {
    return null;
  }

  return {
    id: notification.id,
    type: notification.type as NotificationType,
    actorId: notification.actorId,
    actorName: notification.actorName,
    actorImage: notification.actorImage,
    activityEventId: notification.activityEventId,
    mealPlanId: notification.mealPlanId,
    shoppingListId: notification.shoppingListId,
    commentId: notification.commentId,
    commentPreview,
    isRead: notification.isRead,
    createdAt: notification.createdAt,
  };
}

/**
 * Get paginated notifications for a user
 */
export async function getNotifications(
  db: DbClient,
  params: {
    userId: string;
    cursor?: number;
    limit?: number;
  },
): Promise<{
  items: NotificationItem[];
  nextCursor: number | null;
}> {
  const { userId, cursor, limit = 20 } = params;

  const conditions = cursor
    ? and(eq(notifications.recipientId, userId), lt(notifications.id, cursor))
    : eq(notifications.recipientId, userId);

  const results = await db
    .select({
      notification: notifications,
      commentPreviewSource,
    })
    .from(notifications)
    .leftJoin(
      comments,
      and(
        eq(notifications.commentId, comments.id),
        eq(notifications.activityEventId, comments.activityEventId),
        eq(comments.moderationState, "visible"),
      ),
    )
    .where(conditions)
    .orderBy(desc(notifications.id))
    .limit(limit + 1);

  const hasMore = results.length > limit;
  const items = hasMore ? results.slice(0, limit) : results;

  const lastItem = items[items.length - 1];
  const nextCursor = hasMore && lastItem ? lastItem.notification.id : null;

  return {
    items: items.map((n) => ({
      id: n.notification.id,
      type: n.notification.type as NotificationType,
      actorId: n.notification.actorId,
      actorName: n.notification.actorName,
      actorImage: n.notification.actorImage,
      activityEventId: n.notification.activityEventId,
      mealPlanId: n.notification.mealPlanId,
      shoppingListId: n.notification.shoppingListId,
      commentId: n.notification.commentId,
      commentPreview: formatCommentPreview(n.commentPreviewSource),
      isRead: n.notification.isRead,
      createdAt: n.notification.createdAt,
    })),
    nextCursor,
  };
}

/**
 * Get unread notification count for a user
 */
export async function getUnreadCount(
  db: DbClient,
  userId: string,
): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientId, userId),
        eq(notifications.isRead, false),
      ),
    )
    .then((rows) => rows[0]);

  return result?.count ?? 0;
}

/**
 * Mark notifications as read
 * If notificationIds is not provided, marks all notifications as read
 */
export async function markAsRead(
  db: DbClient,
  params: {
    userId: string;
    notificationIds?: number[];
  },
): Promise<{ success: boolean; updatedCount: number }> {
  const { userId, notificationIds } = params;

  let updatedCount = 0;

  if (notificationIds && notificationIds.length > 0) {
    // Mark specific notifications as read
    const result = await db
      .update(notifications)
      .set({ isRead: true })
      .where(
        and(
          eq(notifications.recipientId, userId),
          inArray(notifications.id, notificationIds),
          eq(notifications.isRead, false),
        ),
      )
      .returning({ id: notifications.id });

    updatedCount = result.length;
  } else {
    // Mark all notifications as read
    const result = await db
      .update(notifications)
      .set({ isRead: true })
      .where(
        and(
          eq(notifications.recipientId, userId),
          eq(notifications.isRead, false),
        ),
      )
      .returning({ id: notifications.id });

    updatedCount = result.length;
  }

  return { success: true, updatedCount };
}
