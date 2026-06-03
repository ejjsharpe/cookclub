import { useCallback, useMemo } from "react";

import { useGetUserRecipes } from "@/api/recipe";

export type Recipe = NonNullable<
  ReturnType<typeof useGetUserRecipes>["data"]
>["pages"][number]["items"][number];

const EMPTY_RECIPES: Recipe[] = [];

interface UseRecipeDataOptions {
  search?: string;
  tagIds?: number[];
  maxTotalTime?: number;
}

export const useRecipeData = ({
  search,
  tagIds,
  maxTotalTime,
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
