import type { QueryClient, QueryFilters } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import {
  invalidateFollowRelatedQueries,
  invalidateUserIdentityQueries,
} from "./cache-helpers";

function pathFilter(queryKey: readonly unknown[]) {
  return {
    pathFilter: (): QueryFilters => ({ queryKey }),
  };
}

function createQueryClient() {
  const invalidateQueries = vi.fn().mockResolvedValue(undefined);
  return {
    invalidateQueries,
    queryClient: { invalidateQueries } as unknown as QueryClient,
  };
}

describe("cache invalidation helpers", () => {
  it("invalidates every query whose result changes after following", async () => {
    const { invalidateQueries, queryClient } = createQueryClient();
    const trpc = {
      follows: pathFilter(["follows"]),
      activity: { getFeed: pathFilter(["activity", "getFeed"]) },
      mealPlan: {
        getShareableUsers: pathFilter(["mealPlan", "getShareableUsers"]),
      },
      shopping: {
        getShoppingListShareableUsers: pathFilter([
          "shopping",
          "getShoppingListShareableUsers",
        ]),
      },
      recipe: {
        getPopularThisWeek: pathFilter(["recipe", "getPopularThisWeek"]),
      },
    };

    await invalidateFollowRelatedQueries(queryClient, trpc);

    expect(
      invalidateQueries.mock.calls.map(([filter]) => filter.queryKey),
    ).toEqual([
      ["follows"],
      ["activity", "getFeed"],
      ["mealPlan", "getShareableUsers"],
      ["shopping", "getShoppingListShareableUsers"],
      ["recipe", "getPopularThisWeek"],
    ]);
  });

  it("invalidates embedded user identity across public caches", async () => {
    const { invalidateQueries, queryClient } = createQueryClient();
    const trpc = {
      user: { getUser: pathFilter(["user", "getUser"]) },
      follows: pathFilter(["follows"]),
      activity: pathFilter(["activity"]),
      collection: pathFilter(["collection"]),
      comment: pathFilter(["comment"]),
      recipe: pathFilter(["recipe"]),
      mealPlan: pathFilter(["mealPlan"]),
      shopping: pathFilter(["shopping"]),
      notification: pathFilter(["notification"]),
    };

    await invalidateUserIdentityQueries(queryClient, trpc);

    expect(
      invalidateQueries.mock.calls.map(([filter]) => filter.queryKey),
    ).toEqual([
      ["user", "getUser"],
      ["follows"],
      ["activity"],
      ["collection"],
      ["comment"],
      ["recipe"],
      ["mealPlan"],
      ["shopping"],
      ["notification"],
    ]);
  });
});
