import { describe, expect, it, vi } from "vitest";

import {
  clearSubscriptionAdminOverride,
  getSubscriptionStatus,
  setSubscriptionAdminOverride,
} from "./subscription.service";

function createSelectBuilder(result: unknown[]) {
  const builder = {
    from: vi.fn(() => builder),
    where: vi.fn(() => builder),
    then: vi.fn((resolve, reject) =>
      Promise.resolve(result).then(resolve, reject),
    ),
  };

  return builder;
}

function createDbWithSelectResults(results: unknown[][]) {
  const queuedResults = [...results];
  return {
    select: vi.fn(() => createSelectBuilder(queuedResults.shift() ?? [])),
  };
}

function createMutationBuilder(returningResult: unknown[]) {
  const builder = {
    values: vi.fn(() => builder),
    where: vi.fn(() => builder),
    onConflictDoUpdate: vi.fn(() => builder),
    returning: vi.fn().mockResolvedValue(returningResult),
  };

  return builder;
}

describe("subscription admin overrides", () => {
  const now = new Date("2026-05-31T12:00:00.000Z");

  it("returns free status when there is no override or active entitlement", async () => {
    const db = createDbWithSelectResults([[], [], []]);

    await expect(
      getSubscriptionStatus(db as any, "user-1", now),
    ).resolves.toMatchObject({
      isPro: false,
      accessLevelId: null,
      smartImports: {
        used: 0,
        limit: 5,
        remaining: 5,
      },
    });
  });

  it("returns Pro when an active Adapty entitlement exists", async () => {
    const db = createDbWithSelectResults([
      [
        {
          accessLevelId: "pro",
          isActive: true,
          expiresAt: new Date("2026-06-30T12:00:00.000Z"),
          willRenew: true,
        },
      ],
      [],
      [{ usedCount: 3 }],
    ]);

    await expect(
      getSubscriptionStatus(db as any, "user-1", now),
    ).resolves.toMatchObject({
      isPro: true,
      accessLevelId: "pro",
      willRenew: true,
      smartImports: {
        used: 3,
        limit: null,
        remaining: null,
      },
    });
  });

  it("manual Pro override takes precedence over missing Adapty entitlement", async () => {
    const db = createDbWithSelectResults([
      [],
      [{ status: "pro", reason: "support grant" }],
      [{ usedCount: 5 }],
    ]);

    await expect(
      getSubscriptionStatus(db as any, "user-1", now),
    ).resolves.toMatchObject({
      isPro: true,
      accessLevelId: "manual",
      expiresAt: null,
      willRenew: null,
      smartImports: {
        used: 5,
        limit: null,
        remaining: null,
      },
    });
  });

  it("manual Free override takes precedence over active Adapty entitlement", async () => {
    const db = createDbWithSelectResults([
      [
        {
          accessLevelId: "pro",
          isActive: true,
          expiresAt: new Date("2026-06-30T12:00:00.000Z"),
          willRenew: true,
        },
      ],
      [{ status: "free", reason: "refund" }],
      [{ usedCount: 4 }],
    ]);

    await expect(
      getSubscriptionStatus(db as any, "user-1", now),
    ).resolves.toMatchObject({
      isPro: false,
      accessLevelId: null,
      expiresAt: null,
      willRenew: null,
      smartImports: {
        used: 4,
        limit: 5,
        remaining: 1,
      },
    });
  });

  it("upserts and clears manual overrides", async () => {
    const override = {
      userId: "user-1",
      status: "pro",
      reason: "support grant",
    };
    const insertBuilder = createMutationBuilder([override]);
    const deleteBuilder = createMutationBuilder([override]);
    const db = {
      insert: vi.fn(() => insertBuilder),
      delete: vi.fn(() => deleteBuilder),
    };

    await expect(
      setSubscriptionAdminOverride(db as any, {
        userId: "user-1",
        status: "pro",
        reason: "support grant",
        actorUserId: "admin-1",
      }),
    ).resolves.toEqual(override);
    await expect(
      clearSubscriptionAdminOverride(db as any, "user-1"),
    ).resolves.toEqual(override);

    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(insertBuilder.onConflictDoUpdate).toHaveBeenCalledTimes(1);
    expect(db.delete).toHaveBeenCalledTimes(1);
  });
});
