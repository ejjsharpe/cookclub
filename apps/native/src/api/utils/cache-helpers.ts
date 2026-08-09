import type { QueryClient, QueryFilters } from "@tanstack/react-query";

type PathFilterFactory = {
  pathFilter: () => QueryFilters;
};

type FollowInvalidationTRPC = {
  follows: PathFilterFactory;
  activity: {
    getFeed: PathFilterFactory;
  };
  mealPlan: {
    getShareableUsers: PathFilterFactory;
  };
  shopping: {
    getShoppingListShareableUsers: PathFilterFactory;
  };
  recipe: {
    getPopularThisWeek: PathFilterFactory;
  };
};

type IdentityInvalidationTRPC = {
  user: {
    getUser: PathFilterFactory;
  };
  follows: PathFilterFactory;
  activity: PathFilterFactory;
  collection: PathFilterFactory;
  comment: PathFilterFactory;
  recipe: PathFilterFactory;
  mealPlan: PathFilterFactory;
  shopping: PathFilterFactory;
  notification: PathFilterFactory;
};

export async function invalidateFollowRelatedQueries(
  queryClient: QueryClient,
  trpc: FollowInvalidationTRPC,
) {
  await Promise.all([
    queryClient.invalidateQueries(trpc.follows.pathFilter()),
    queryClient.invalidateQueries(trpc.activity.getFeed.pathFilter()),
    queryClient.invalidateQueries(trpc.mealPlan.getShareableUsers.pathFilter()),
    queryClient.invalidateQueries(
      trpc.shopping.getShoppingListShareableUsers.pathFilter(),
    ),
    queryClient.invalidateQueries(trpc.recipe.getPopularThisWeek.pathFilter()),
  ]);
}

export async function invalidateUserIdentityQueries(
  queryClient: QueryClient,
  trpc: IdentityInvalidationTRPC,
) {
  await Promise.all([
    queryClient.invalidateQueries(trpc.user.getUser.pathFilter()),
    queryClient.invalidateQueries(trpc.follows.pathFilter()),
    queryClient.invalidateQueries(trpc.activity.pathFilter()),
    queryClient.invalidateQueries(trpc.collection.pathFilter()),
    queryClient.invalidateQueries(trpc.comment.pathFilter()),
    queryClient.invalidateQueries(trpc.recipe.pathFilter()),
    queryClient.invalidateQueries(trpc.mealPlan.pathFilter()),
    queryClient.invalidateQueries(trpc.shopping.pathFilter()),
    queryClient.invalidateQueries(trpc.notification.pathFilter()),
  ]);
}

/**
 * Updates the collectionIds for a specific recipe across all query caches
 * This ensures consistent state between recipe details and collections
 */
export function updateRecipeCollections(
  queryClient: QueryClient,
  trpc: ReturnType<typeof import("@repo/trpc/client").useTRPC>,
  recipeId: number,
  collectionIds: number[],
) {
  // Get type-safe filter
  const recipeDetailFilter = trpc.recipe.getRecipeDetail.pathFilter();

  // Update recipe detail query
  queryClient.setQueriesData<any>(recipeDetailFilter, (old: any) => {
    if (!old || old.id !== recipeId) return old;
    return {
      ...old,
      collectionIds: [...collectionIds], // Create new array reference
    };
  });
}
