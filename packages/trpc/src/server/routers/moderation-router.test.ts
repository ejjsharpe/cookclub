import { mealPlanInvitations, shoppingListInvitations } from "@repo/db/schemas";
import { describe, expect, it, vi } from "vitest";

import { moderationRouter } from "./moderation-router";

const mocks = vi.hoisted(() => ({
  removeUserFromFeed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/activity", () => ({
  removeUserFromFeed: mocks.removeUserFromFeed,
}));

vi.mock("@repo/db/services", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/db/services")>()),
  areUsersBlocked: vi.fn().mockResolvedValue(false),
}));

function targetFor(type: "user" | "comment" | "activity" | "recipe") {
  switch (type) {
    case "user":
      return { id: "target-user", name: "Target", banned: false };
    case "comment":
      return { id: 12, userId: "target-user", content: "Evidence" };
    case "activity":
      return { id: 13, userId: "target-user", reviewText: "Evidence" };
    case "recipe":
      return { id: 14, ownerId: "target-user", name: "Evidence" };
  }
}

function createContext(options?: {
  selectResults?: unknown[][];
  rateLimitSuccess?: boolean;
  emailError?: Error;
}) {
  const selectResults = [...(options?.selectResults ?? [])];
  const inserted: unknown[] = [];
  const deleted: unknown[] = [];
  const background: Promise<unknown>[] = [];
  const emailSend = options?.emailError
    ? vi.fn().mockRejectedValue(options.emailError)
    : vi.fn().mockResolvedValue(undefined);

  const db = {
    select: vi.fn(() => {
      const result = selectResults.shift() ?? [];
      const chain = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        leftJoin: vi.fn(() => chain),
        limit: vi.fn(() => chain),
        then: (
          resolve: (value: unknown[]) => unknown,
          reject: (error: unknown) => unknown,
        ) => Promise.resolve(result).then(resolve, reject),
      };
      return chain;
    }),
    insert: vi.fn(() => {
      const chain = {
        values: vi.fn((value: unknown) => {
          inserted.push(value);
          return chain;
        }),
        returning: vi.fn().mockImplementation(() =>
          Promise.resolve([
            {
              ...(inserted.at(-1) as Record<string, unknown>),
              id: 91,
              createdAt: new Date("2026-08-02T12:00:00.000Z"),
            },
          ]),
        ),
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      };
      return chain;
    }),
    delete: vi.fn((table: unknown) => {
      deleted.push(table);
      return {
        where: vi.fn().mockResolvedValue(undefined),
      };
    }),
    transaction: vi.fn(),
  };
  db.transaction.mockImplementation(
    async (callback: (tx: typeof db) => Promise<unknown>) => callback(db),
  );

  return {
    ctx: {
      db,
      env: {
        MODERATION_RATE_LIMITER: {
          limit: vi
            .fn()
            .mockResolvedValue({ success: options?.rateLimitSuccess ?? true }),
        },
        EMAIL: { send: emailSend },
      },
      user: { id: "reporter", name: "Reporter", image: null },
      req: new Request("https://api.cookclub.app/trpc"),
      resHeaders: new Headers(),
      requestId: "request-1",
      waitUntil: vi.fn((promise: Promise<unknown>) => background.push(promise)),
    },
    background,
    emailSend,
    inserted,
    deleted,
  };
}

describe("moderation.createReport", () => {
  it.each(["user", "comment", "activity", "recipe"] as const)(
    "captures an immutable %s evidence snapshot before alerting",
    async (targetType) => {
      const target = targetFor(targetType);
      const state = createContext({
        selectResults: [[{ count: 0 }], [], [target]],
      });
      const caller = moderationRouter.createCaller(state.ctx as never);

      await expect(
        caller.createReport({
          targetType,
          targetId: String(target.id),
          reason: "other",
        }),
      ).resolves.toMatchObject({ id: 91 });

      expect(state.inserted[0]).toMatchObject({
        reporterUserId: "reporter",
        targetType,
        targetId: String(target.id),
        targetSnapshot: { targetType, content: target },
      });
      expect(state.emailSend).toHaveBeenCalledOnce();
    },
  );

  it.each([
    "spam_scam",
    "harassment_hate",
    "sexual_content",
    "violence_danger",
    "child_safety",
    "intellectual_property",
    "other",
  ] as const)("accepts the %s reason", async (reason) => {
    const state = createContext({
      selectResults: [[{ count: 0 }], [], [targetFor("user")]],
    });
    const caller = moderationRouter.createCaller(state.ctx as never);
    await expect(
      caller.createReport({
        targetType: "user",
        targetId: "target-user",
        reason,
      }),
    ).resolves.toMatchObject({ id: 91 });
    expect(state.inserted[0]).toMatchObject({ reason });
  });

  it("rejects a duplicate open report", async () => {
    const state = createContext({
      selectResults: [[{ count: 0 }], [{ id: 1 }]],
    });
    const caller = moderationRouter.createCaller(state.ctx as never);
    await expect(
      caller.createReport({
        targetType: "user",
        targetId: "target-user",
        reason: "spam_scam",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(state.inserted).toHaveLength(0);
  });

  it("enforces both edge and database report rate limits", async () => {
    const edge = createContext({ rateLimitSuccess: false });
    await expect(
      moderationRouter.createCaller(edge.ctx as never).createReport({
        targetType: "user",
        targetId: "target-user",
        reason: "other",
      }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });

    const database = createContext({ selectResults: [[{ count: 10 }]] });
    await expect(
      moderationRouter.createCaller(database.ctx as never).createReport({
        targetType: "user",
        targetId: "target-user",
        reason: "other",
      }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("keeps a persisted child-safety report when asynchronous email fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const state = createContext({
      selectResults: [[{ count: 0 }], [], [targetFor("user")]],
      emailError: new Error("email unavailable"),
    });
    const caller = moderationRouter.createCaller(state.ctx as never);

    await expect(
      caller.createReport({
        targetType: "user",
        targetId: "target-user",
        reason: "child_safety",
      }),
    ).resolves.toMatchObject({ id: 91 });
    await Promise.all(state.background);

    expect(state.inserted).toHaveLength(1);
    expect(state.emailSend).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining("URGENT CHILD SAFETY"),
      }),
    );
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("moderation.blockUser", () => {
  it("revokes shared meal-plan and shopping-list access", async () => {
    const state = createContext({ selectResults: [[{ id: "blocked-user" }]] });
    const caller = moderationRouter.createCaller(state.ctx as never);

    await expect(caller.blockUser({ userId: "blocked-user" })).resolves.toEqual(
      { success: true },
    );

    expect(state.deleted).toEqual(
      expect.arrayContaining([mealPlanInvitations, shoppingListInvitations]),
    );
    expect(mocks.removeUserFromFeed).toHaveBeenCalledTimes(2);
  });
});
