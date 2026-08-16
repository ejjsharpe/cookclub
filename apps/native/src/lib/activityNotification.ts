export type ActivityNotificationTarget = {
  activityEventId: number;
  commentId?: number;
};

type ActivityNotificationData = {
  type?: unknown;
  activityEventId?: unknown;
  commentId?: unknown;
};

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function getActivityNotificationTarget(
  data: ActivityNotificationData,
): ActivityNotificationTarget | null {
  if (!isPositiveInteger(data.activityEventId)) {
    return null;
  }

  if (data.type === "activity_like") {
    return { activityEventId: data.activityEventId };
  }

  if (
    (data.type === "activity_comment" ||
      data.type === "comment_reply" ||
      data.type === "comment_mention") &&
    isPositiveInteger(data.commentId)
  ) {
    return {
      activityEventId: data.activityEventId,
      commentId: data.commentId,
    };
  }

  return null;
}
