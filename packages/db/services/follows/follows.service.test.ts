import { beforeEach, describe, expect, it, vi } from "vitest";

import { ServiceError } from "../errors";
import { followUser, unfollowUser } from "./follows.service";

const moderationMocks = vi.hoisted(() => ({
  areUsersBlocked: vi.fn(),
  getBlockedUserIds: vi.fn(),
}));

vi.mock("../moderation", () => moderationMocks);

function selectBuilder(result: unknown[]) {
  const builder = {
    from: vi.fn(() => builder),
    where: vi.fn(() => builder),
    then: vi.fn((resolve, reject) =>
      Promise.resolve(result).then(resolve, reject),
    ),
  };
  return builder;
}

function createDb(selectResults: unknown[][], inserted: unknown[] = []) {
  const queued = [...selectResults];
  const insertBuilder = {
    values: vi.fn(() => insertBuilder),
    returning: vi.fn(() => selectBuilder(inserted)),
  };
  const deleteBuilder = { where: vi.fn().mockResolvedValue(undefined) };
  return {
    select: vi.fn(() => selectBuilder(queued.shift() ?? [])),
    insert: vi.fn(() => insertBuilder),
    delete: vi.fn(() => deleteBuilder),
    insertBuilder,
    deleteBuilder,
  };
}

describe("follow service business rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    moderationMocks.areUsersBlocked.mockResolvedValue(false);
  });

  it("rejects following yourself before touching the database", async () => {
    const db = createDb([]);

    await expect(
      followUser(db as never, "user-1", "user-1"),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(moderationMocks.areUsersBlocked).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
  });

  it("rejects interactions in either direction when users are blocked", async () => {
    moderationMocks.areUsersBlocked.mockResolvedValue(true);
    const db = createDb([]);

    await expect(
      followUser(db as never, "user-1", "user-2"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("rejects duplicate follows and missing target users distinctly", async () => {
    await expect(
      followUser(createDb([[{ id: 1 }]]) as never, "user-1", "user-2"),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await expect(
      followUser(createDb([[], []]) as never, "user-1", "missing"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("creates a follow only after validating the target", async () => {
    const follow = {
      id: 7,
      followerId: "user-1",
      followingId: "user-2",
    };
    const db = createDb([[], [{ id: "user-2" }]], [follow]);

    await expect(followUser(db as never, "user-1", "user-2")).resolves.toEqual(
      follow,
    );
    expect(db.insertBuilder.values).toHaveBeenCalledWith(
      expect.objectContaining({
        followerId: "user-1",
        followingId: "user-2",
        createdAt: expect.any(Date),
      }),
    );
  });

  it("rejects an unfollow that does not exist", async () => {
    const db = createDb([[]]);

    await expect(
      unfollowUser(db as never, "user-1", "user-2"),
    ).rejects.toBeInstanceOf(ServiceError);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("deletes an existing follow", async () => {
    const db = createDb([[{ id: 9 }]]);

    await expect(
      unfollowUser(db as never, "user-1", "user-2"),
    ).resolves.toEqual({ success: true });
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.deleteBuilder.where).toHaveBeenCalledTimes(1);
  });
});
