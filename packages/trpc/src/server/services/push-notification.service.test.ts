import type { NotificationItem, PushTokenItem } from "@repo/db/services";
import { describe, expect, it } from "vitest";

import {
  buildExpoPushMessages,
  getPushNotificationBody,
  getPushNotificationData,
  isDeviceNotRegistered,
  mapExpoTicketsToRows,
} from "./push-notification.service";

const baseNotification: NotificationItem = {
  id: 123,
  type: "follow",
  actorId: "actor-1",
  actorName: "Alex",
  actorImage: null,
  activityEventId: null,
  mealPlanId: null,
  shoppingListId: null,
  commentId: null,
  commentPreview: null,
  isRead: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

describe("push notification mapping", () => {
  it.each([
    ["follow", "Alex started following you"],
    ["meal_plan_share", "Alex shared a meal plan with you"],
    ["meal_plan_invite", "Alex invited you to a meal plan"],
    ["shopping_list_invite", "Alex invited you to a shopping list"],
    ["activity_like", "Alex liked your activity"],
  ] as const)("maps %s body text", (type, expected) => {
    expect(
      getPushNotificationBody({
        actorName: "Alex",
        type,
        commentPreview: null,
      }),
    ).toBe(expected);
  });

  it.each([
    ["activity_comment", "Alex commented on your activity"],
    ["comment_reply", "Alex replied to your comment"],
    ["comment_mention", "Alex mentioned you in a comment"],
  ] as const)("includes the comment preview in %s bodies", (type, action) => {
    expect(
      getPushNotificationBody({
        actorName: "Alex",
        type,
        commentPreview: "This looks delicious!",
      }),
    ).toBe(`${action}: “This looks delicious!”`);
  });

  it("falls back to the action when a comment preview is unavailable", () => {
    expect(
      getPushNotificationBody({
        actorName: "Alex",
        type: "activity_comment",
        commentPreview: null,
      }),
    ).toBe("Alex commented on your activity");
  });

  it("includes only relevant notification data fields", () => {
    expect(
      getPushNotificationData({
        ...baseNotification,
        type: "comment_reply",
        activityEventId: 10,
        commentId: 20,
      }),
    ).toEqual({
      notificationId: 123,
      type: "comment_reply",
      actorId: "actor-1",
      activityEventId: 10,
      commentId: 20,
    });
  });

  it("builds Expo messages for enabled tokens", () => {
    const tokens: PushTokenItem[] = [
      {
        id: 1,
        userId: "user-1",
        expoPushToken: "ExponentPushToken[android]",
        platform: "android",
        enabled: true,
      },
      {
        id: 2,
        userId: "user-1",
        expoPushToken: "ExponentPushToken[ios]",
        platform: "ios",
        enabled: true,
      },
    ];

    const messages = buildExpoPushMessages(baseNotification, tokens);

    expect(messages).toEqual([
      expect.objectContaining({
        to: "ExponentPushToken[android]",
        title: "cookclub",
        body: "Alex started following you",
        channelId: "default",
      }),
      expect.objectContaining({
        to: "ExponentPushToken[ios]",
        title: "cookclub",
        body: "Alex started following you",
      }),
    ]);
    expect(messages[1]).not.toHaveProperty("channelId");
  });

  it("maps Expo tickets into stored ticket rows", () => {
    const tokens: PushTokenItem[] = [
      {
        id: 1,
        userId: "user-1",
        expoPushToken: "ExponentPushToken[one]",
        platform: "ios",
        enabled: true,
      },
      {
        id: 2,
        userId: "user-1",
        expoPushToken: "ExponentPushToken[two]",
        platform: "ios",
        enabled: true,
      },
      {
        id: 3,
        userId: "user-1",
        expoPushToken: "ExponentPushToken[three]",
        platform: "ios",
        enabled: true,
      },
    ];

    expect(
      mapExpoTicketsToRows({
        notificationId: 123,
        tokens,
        tickets: [
          { status: "ok", id: "ticket-1" },
          {
            status: "error",
            message: "Device is not registered",
            details: { error: "DeviceNotRegistered" },
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        notificationId: 123,
        pushTokenId: 1,
        expoTicketId: "ticket-1",
        status: "ok",
        receiptStatus: "pending",
      }),
      expect.objectContaining({
        notificationId: 123,
        pushTokenId: 2,
        expoTicketId: null,
        status: "error",
        receiptStatus: "unavailable",
      }),
      expect.objectContaining({
        notificationId: 123,
        pushTokenId: 3,
        status: "error",
        receiptStatus: "unavailable",
      }),
    ]);
  });

  it("detects DeviceNotRegistered receipt errors", () => {
    expect(isDeviceNotRegistered({ error: "DeviceNotRegistered" })).toBe(true);
    expect(isDeviceNotRegistered({ error: "MessageTooBig" })).toBe(false);
    expect(isDeviceNotRegistered(null)).toBe(false);
  });
});
