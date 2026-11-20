import { useCallback, useMemo } from "react";

import {
  useGetUserRecipes,
  type RecipeSort,
  type RecipeSourceFilter,
} from "@/api/recipe";

export type Recipe = NonNullable<
  ReturnType<typeof useGetUserRecipes>["data"]
>["pages"][number]["items"][number];

const EMPTY_RECIPES: Recipe[] = [];

interface UseRecipeDataOptions {
  search?: string;
  tagIds?: number[];
  maxTotalTime?: number;
  sort?: RecipeSort;
  source?: RecipeSourceFilter;
  limit?: number;
  enabled?: boolean;
}

export const useRecipeData = ({
  search,
  tagIds,
  maxTotalTime,
  sort,
  source,
  limit,
  enabled,
}: UseRecipeDataOptions = {}) => {
  const {
    data: recipesData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending,
    refetch,
    error,
  } = useGetUserRecipes({
    search,
    tagIds,
    maxTotalTime,
    ...(sort ? { sort } : {}),
    ...(source ? { source } : {}),
    ...(limit ? { limit } : {}),
    ...(enabled === undefined ? {} : { enabled }),
  });

  const recipes = useMemo(() => {
    return (
      recipesData?.pages.flatMap((page) => page?.items ?? []) ?? EMPTY_RECIPES
    );
  }, [recipesData]);

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return {
    recipes,
    isPending,
    error,
    isFetchingNext: isFetchingNextPage,
    hasMore: hasNextPage,
    handleLoadMore,
    refetch,
  };
};
