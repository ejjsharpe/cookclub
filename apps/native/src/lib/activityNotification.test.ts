import { describe, expect, it } from "vitest";

import { getActivityNotificationTarget } from "./activityNotification";

describe("getActivityNotificationTarget", () => {
  it("targets the activity for a like notification", () => {
    expect(
      getActivityNotificationTarget({
        type: "activity_like",
        activityEventId: 42,
      }),
    ).toEqual({ activityEventId: 42 });
  });

  it.each(["activity_comment", "comment_reply", "comment_mention"])(
    "targets the activity and comment for %s notifications",
    (type) => {
      expect(
        getActivityNotificationTarget({
          type,
          activityEventId: 42,
          commentId: 17,
        }),
      ).toEqual({ activityEventId: 42, commentId: 17 });
    },
  );

  it("rejects unrelated and incomplete notification data", () => {
    expect(
      getActivityNotificationTarget({
        type: "follow",
        activityEventId: 42,
      }),
    ).toBeNull();
    expect(
      getActivityNotificationTarget({
        type: "activity_like",
        activityEventId: 0,
      }),
    ).toBeNull();
    expect(
      getActivityNotificationTarget({
        type: "activity_like",
      }),
    ).toBeNull();
    expect(
      getActivityNotificationTarget({
        type: "activity_comment",
        activityEventId: 42,
      }),
    ).toBeNull();
    expect(
      getActivityNotificationTarget({
        type: "comment_reply",
        activityEventId: 42,
        commentId: -1,
      }),
    ).toBeNull();
  });
});
