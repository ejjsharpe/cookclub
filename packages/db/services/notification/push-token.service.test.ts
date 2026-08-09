import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createPushNotificationTickets,
  getPendingPushNotificationTickets,
  markPushTicketReceipts,
  markPushTicketsUnavailable,
  registerPushToken,
  unregisterPushToken,
} from "./push-token.service";

function mutationBuilder(returningResult: unknown[] = []) {
  const builder = {
    values: vi.fn(() => builder),
    set: vi.fn(() => builder),
    where: vi.fn(() => builder),
    onConflictDoUpdate: vi.fn(() => builder),
    returning: vi.fn().mockResolvedValue(returningResult),
  };
  return builder;
}

function selectBuilder(result: unknown[]) {
  const builder = {
    from: vi.fn(() => builder),
    where: vi.fn(() => builder),
    limit: vi.fn().mockResolvedValue(result),
  };
  return builder;
}

describe("push token persistence", () => {
  const now = new Date("2026-08-09T12:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("upserts a token and re-enables an existing device registration", async () => {
    const token = {
      id: 1,
      userId: "user-1",
      expoPushToken: "ExponentPushToken[test]",
      platform: "ios",
      enabled: true,
    };
    const builder = mutationBuilder([token]);
    const db = { insert: vi.fn(() => builder) };

    await expect(
      registerPushToken(db as never, {
        userId: "user-1",
        expoPushToken: "ExponentPushToken[test]",
        platform: "ios",
      }),
    ).resolves.toEqual(token);
    expect(builder.values).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        disabledAt: null,
        lastSeenAt: now,
      }),
    );
    expect(builder.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({ enabled: true, disabledAt: null }),
      }),
    );
  });

  it("fails explicitly when the upsert returns no token", async () => {
    const builder = mutationBuilder([]);
    const db = { insert: vi.fn(() => builder) };

    await expect(
      registerPushToken(db as never, {
        userId: "user-1",
        expoPushToken: "ExponentPushToken[test]",
        platform: "android",
      }),
    ).rejects.toThrow("Failed to register push token");
  });

  it("reports how many matching user tokens were disabled", async () => {
    const builder = mutationBuilder([{ id: 1 }, { id: 2 }]);
    const db = { update: vi.fn(() => builder) };

    await expect(
      unregisterPushToken(db as never, {
        userId: "user-1",
        expoPushToken: "ExponentPushToken[test]",
      }),
    ).resolves.toEqual({ success: true, updatedCount: 2 });
    expect(builder.set).toHaveBeenCalledWith({
      enabled: false,
      disabledAt: now,
      updatedAt: now,
    });
  });
});

describe("push notification tickets", () => {
  it("does not write an empty ticket batch", async () => {
    const db = { insert: vi.fn() };

    await createPushNotificationTickets(db as never, []);

    expect(db.insert).not.toHaveBeenCalled();
  });

  it("sets receipt defaults from the Expo ticket outcome", async () => {
    const builder = mutationBuilder();
    const db = { insert: vi.fn(() => builder) };

    await createPushNotificationTickets(db as never, [
      {
        notificationId: 1,
        pushTokenId: 11,
        expoTicketId: "ticket-ok",
        status: "ok",
      },
      {
        notificationId: 2,
        pushTokenId: 12,
        status: "error",
        message: "DeviceNotRegistered",
      },
    ]);

    expect(builder.values).toHaveBeenCalledWith([
      expect.objectContaining({
        expoTicketId: "ticket-ok",
        receiptStatus: "pending",
      }),
      expect.objectContaining({
        expoTicketId: null,
        receiptStatus: "unavailable",
        message: "DeviceNotRegistered",
      }),
    ]);
  });

  it("filters null Expo IDs defensively and honors the query limit", async () => {
    const builder = selectBuilder([
      { id: 1, pushTokenId: 11, expoTicketId: "ticket-1" },
      { id: 2, pushTokenId: 12, expoTicketId: null },
    ]);
    const db = { select: vi.fn(() => builder) };

    await expect(
      getPendingPushNotificationTickets(db as never, {
        olderThan: new Date("2026-08-09T00:00:00Z"),
        limit: 25,
      }),
    ).resolves.toEqual([{ id: 1, pushTokenId: 11, expoTicketId: "ticket-1" }]);
    expect(builder.limit).toHaveBeenCalledWith(25);
  });

  it("updates every returned receipt and skips empty unavailable batches", async () => {
    const builders = [mutationBuilder(), mutationBuilder()];
    const db = {
      update: vi.fn(() => builders.shift() ?? mutationBuilder()),
    };

    await markPushTicketReceipts(db as never, [
      { ticketId: 1, status: "ok" },
      { ticketId: 2, status: "error", message: "invalid token" },
    ]);
    expect(db.update).toHaveBeenCalledTimes(2);

    db.update.mockClear();
    await markPushTicketsUnavailable(db as never, []);
    expect(db.update).not.toHaveBeenCalled();
  });
});
