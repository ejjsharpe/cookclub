import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuth: vi.fn(),
  userHasPermission: vi.fn(),
  banUser: vi.fn(),
  setSubscriptionAdminOverride: vi.fn(),
  clearSubscriptionAdminOverride: vi.fn(),
  recordAdminAuditEvent: vi.fn(),
  publicSubscriptionTierSql: vi.fn(() => ({ type: "subscriptionTierSql" })),
  publicSubscriptionTierSqlForUserTable: vi.fn(() => ({
    type: "subscriptionTierSqlForUserTable",
  })),
  deleteUserAccountData: vi.fn(),
}));

vi.mock("@repo/auth", () => ({
  getAuth: mocks.getAuth,
}));

vi.mock("@repo/db/services", () => ({
  setSubscriptionAdminOverride: mocks.setSubscriptionAdminOverride,
  clearSubscriptionAdminOverride: mocks.clearSubscriptionAdminOverride,
  recordAdminAuditEvent: mocks.recordAdminAuditEvent,
  publicSubscriptionTierSql: mocks.publicSubscriptionTierSql,
  publicSubscriptionTierSqlForUserTable:
    mocks.publicSubscriptionTierSqlForUserTable,
}));

vi.mock("./user-router", () => ({
  deleteUserAccountData: mocks.deleteUserAccountData,
}));

// eslint-disable-next-line import/first
import { adminRouter } from "./admin-router";
// eslint-disable-next-line import/first
import { createMockEnv } from "../__mocks__/env";

function createSelectLimitBuilder(result: unknown[]) {
  const builder = {
    from: vi.fn(() => builder),
    where: vi.fn(() => builder),
    limit: vi.fn().mockResolvedValue(result),
  };

  return builder;
}

function createDb(selectResults: unknown[][] = []) {
  const queuedResults = [...selectResults];
  const db = {
    select: vi.fn(() => createSelectLimitBuilder(queuedResults.shift() ?? [])),
    transaction: vi.fn(async (callback) => callback(db)),
  };

  return db;
}

function createContext(overrides: Record<string, unknown> = {}) {
  return {
    db: createDb(),
    env: createMockEnv(),
    req: new Request("https://api.cookclub.app/trpc", {
      headers: { cookie: "better-auth.session_token=test" },
    }),
    resHeaders: new Headers(),
    user: {
      id: "admin-1",
      name: "Admin",
      email: "admin@example.com",
      image: null,
    },
    waitUntil: vi.fn(),
    ...overrides,
  };
}

describe("adminRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuth.mockImplementation((env) => ({
      api: {
        userHasPermission: (input: unknown) =>
          mocks.userHasPermission(input, env),
        banUser: mocks.banUser,
      },
    }));
    mocks.userHasPermission.mockResolvedValue({ success: true });
    mocks.setSubscriptionAdminOverride.mockResolvedValue({
      userId: "user-1",
      status: "pro",
      reason: "support",
    });
    mocks.deleteUserAccountData.mockResolvedValue({ deletedImageCount: 2 });
    mocks.recordAdminAuditEvent.mockResolvedValue({ id: 1 });
  });

  it("rejects unauthenticated callers", async () => {
    const caller = adminRouter.createCaller(
      createContext({ user: null }) as any,
    );

    await expect(caller.listUsers({})).rejects.toHaveProperty(
      "code",
      "UNAUTHORIZED",
    );
  });

  it("rejects non-admin callers", async () => {
    mocks.userHasPermission.mockResolvedValue({ success: false });
    const caller = adminRouter.createCaller(createContext() as any);

    await expect(caller.listUsers({})).rejects.toHaveProperty(
      "code",
      "FORBIDDEN",
    );
  });

  it("requires set-role permission for subscription overrides", async () => {
    mocks.userHasPermission.mockImplementation(
      (input: { body: { permissions: { user: string[] } } }) =>
        Promise.resolve({
          success: input.body.permissions.user.includes("list"),
        }),
    );
    const caller = adminRouter.createCaller(createContext() as any);

    await expect(
      caller.setSubscriptionOverride({
        userId: "user-1",
        status: "pro",
        reason: "support",
      }),
    ).rejects.toHaveProperty("code", "FORBIDDEN");

    await expect(
      caller.clearSubscriptionOverride({
        userId: "user-1",
        reason: "support",
      }),
    ).rejects.toHaveProperty("code", "FORBIDDEN");

    expect(mocks.setSubscriptionAdminOverride).not.toHaveBeenCalled();
    expect(mocks.clearSubscriptionAdminOverride).not.toHaveBeenCalled();
  });

  it("allows a bootstrap admin user id through Better Auth permissions", async () => {
    mocks.userHasPermission.mockImplementation((_input, env) =>
      Promise.resolve({
        success: env.BETTER_AUTH_ADMIN_USER_IDS === "admin-1",
      }),
    );
    const ctx = createContext({
      db: createDb([[{ id: "user-1" }]]),
      env: {
        ...createMockEnv(),
        BETTER_AUTH_ADMIN_USER_IDS: "admin-1",
      },
    });
    const caller = adminRouter.createCaller(ctx as any);

    await expect(
      caller.setSubscriptionOverride({
        userId: "user-1",
        status: "pro",
        reason: "support",
      }),
    ).resolves.toEqual({
      override: {
        userId: "user-1",
        status: "pro",
        reason: "support",
      },
    });
  });

  it("writes audit events for subscription override mutations", async () => {
    const ctx = createContext({ db: createDb([[{ id: "user-1" }]]) });
    const caller = adminRouter.createCaller(ctx as any);

    await caller.setSubscriptionOverride({
      userId: "user-1",
      status: "pro",
      reason: "support grant",
    });

    expect(ctx.db.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.setSubscriptionAdminOverride).toHaveBeenCalledWith(ctx.db, {
      userId: "user-1",
      status: "pro",
      reason: "support grant",
      actorUserId: "admin-1",
    });
    expect(mocks.recordAdminAuditEvent).toHaveBeenCalledWith(ctx.db, {
      eventType: "subscription.override.set",
      actorUserId: "admin-1",
      targetUserId: "user-1",
      reason: "support grant",
      metadata: { status: "pro" },
    });
  });

  it("rejects self-ban before calling Better Auth", async () => {
    const caller = adminRouter.createCaller(createContext() as any);

    await expect(
      caller.banUser({ userId: "admin-1", reason: "test" }),
    ).rejects.toHaveProperty("code", "BAD_REQUEST");
    expect(mocks.banUser).not.toHaveBeenCalled();
  });

  it("rejects self-delete", async () => {
    const caller = adminRouter.createCaller(createContext() as any);

    await expect(
      caller.deleteUser({
        userId: "admin-1",
        confirmationEmail: "admin@example.com",
      }),
    ).rejects.toHaveProperty("code", "BAD_REQUEST");
  });

  it("requires matching email confirmation before deleting a user", async () => {
    const ctx = createContext({
      db: createDb([[{ id: "user-1", email: "person@example.com" }]]),
    });
    const caller = adminRouter.createCaller(ctx as any);

    await expect(
      caller.deleteUser({
        userId: "user-1",
        confirmationEmail: "wrong@example.com",
      }),
    ).rejects.toHaveProperty("code", "BAD_REQUEST");

    expect(mocks.deleteUserAccountData).not.toHaveBeenCalled();
  });

  it("deletes a user after matching email confirmation", async () => {
    const ctx = createContext({
      db: createDb([[{ id: "user-1", email: "person@example.com" }]]),
    });
    const caller = adminRouter.createCaller(ctx as any);

    await expect(
      caller.deleteUser({
        userId: "user-1",
        confirmationEmail: "PERSON@example.com ",
      }),
    ).resolves.toEqual({ deletedImageCount: 2 });

    expect(mocks.deleteUserAccountData).toHaveBeenCalledWith(ctx, "user-1");
    expect(mocks.recordAdminAuditEvent).toHaveBeenCalledWith(ctx.db, {
      eventType: "user.delete",
      actorUserId: "admin-1",
      targetUserId: "user-1",
      metadata: {
        deletedImageCount: 2,
        email: "person@example.com",
      },
    });
  });
});
