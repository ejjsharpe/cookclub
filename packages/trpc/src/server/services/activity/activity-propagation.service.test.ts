import { describe, expect, it, vi } from "vitest";

import { propagateActivityToFollowersInBackground } from "./activity-propagation.service";

function createFollowersDb(followerIds: string[]) {
  const query = {
    from: vi.fn().mockReturnThis(),
    where: vi
      .fn()
      .mockResolvedValue(followerIds.map((followerId) => ({ followerId }))),
  };

  return {
    select: vi.fn(() => query),
  } as any;
}

function createFeedEnv() {
  const stub = {
    fetch: vi.fn().mockResolvedValue(new Response("OK")),
  };

  return {
    USER_FEED: {
      idFromName: vi.fn((name: string) => ({ name })),
      get: vi.fn(() => stub),
    },
    _stub: stub,
  } as any;
}

describe("propagateActivityToFollowersInBackground", () => {
  it("registers feed propagation with waitUntil", async () => {
    const db = createFollowersDb(["follower-1", "follower-2"]);
    const env = createFeedEnv();
    const waitUntilPromises: Promise<unknown>[] = [];
    const waitUntil = vi.fn((promise: Promise<unknown>) => {
      waitUntilPromises.push(promise);
    });

    await propagateActivityToFollowersInBackground(
      { db, env, waitUntil },
      123,
      "owner-1",
      new Date("2026-06-02T12:00:00.000Z"),
      "Propagation failed:",
    );

    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));

    await Promise.all(waitUntilPromises);

    expect(env.USER_FEED.idFromName).toHaveBeenCalledWith("owner-1");
    expect(env.USER_FEED.idFromName).toHaveBeenCalledWith("follower-1");
    expect(env.USER_FEED.idFromName).toHaveBeenCalledWith("follower-2");
    expect(env._stub.fetch).toHaveBeenCalledTimes(3);
  });
});
