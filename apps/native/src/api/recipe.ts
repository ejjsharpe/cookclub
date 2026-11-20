import { MIN_RECIPE_SEARCH_LENGTH } from "@repo/shared";
import type { Inputs, Outputs } from "@repo/trpc/client";
import { useTRPC } from "@repo/trpc/client";
import {
  keepPreviousData,
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useMemo } from "react";

import { useSessionContext } from "@/lib/sessionContext";

// API Response Types
export type Recipe = Outputs["recipe"]["getRecipeDetail"];
export type RecipeListItem =
  Outputs["recipe"]["getUserRecipes"]["items"][number];
export type ParsedRecipe = Extract<
  NonNullable<Outputs["recipeImport"]["get"]["recipe"]>,
  { success: true }
>;
export type PersonalizationGoal =
  Inputs["recipeAi"]["personalizeRecipe"]["goals"][number];

/**
 * "default" is newest first while browsing and best match while searching.
 */
export type RecipeSort = "default" | "name" | "time";
export type RecipeSourceFilter = "mine" | "web" | "cook";

interface UseGetUserRecipesParams {
  search?: string;
  limit?: number;
  tagIds?: number[];
  maxTotalTime?: number;
  sort?: RecipeSort;
  source?: RecipeSourceFilter;
  enabled?: boolean;
  /** Keep showing the last result while a changed query loads. */
  keepPreviousData?: boolean;
}

export const useGetUserRecipes = ({
  search,
  limit = 20,
  tagIds,
  maxTotalTime,
  sort = "default",
  source,
  enabled = true,
  keepPreviousData: keepPrevious = false,
}: UseGetUserRecipesParams = {}) => {
  const trpc = useTRPC();
  const normalizedSearch = search?.trim() || undefined;
  const isSearchActive =
    (normalizedSearch?.length ?? 0) >= MIN_RECIPE_SEARCH_LENGTH;
  const normalizedTagIds = tagIds && tagIds.length > 0 ? tagIds : undefined;
  const normalizedMaxTotalTime =
    maxTotalTime != null && Number.isFinite(maxTotalTime)
      ? maxTotalTime
      : undefined;

  const keysetSort = sort === "default" ? undefined : sort;

  const sharedInput = useMemo(
    () => ({
      limit,
      ...(normalizedTagIds ? { tagIds: normalizedTagIds } : {}),
      ...(normalizedMaxTotalTime != null
        ? { maxTotalTime: normalizedMaxTotalTime }
        : {}),
      ...(keysetSort ? { sort: keysetSort } : {}),
      ...(source ? { source } : {}),
    }),
    [limit, normalizedTagIds, normalizedMaxTotalTime, keysetSort, source],
  );

  const searchInput = useMemo(
    () => ({
      ...sharedInput,
      query: normalizedSearch ?? "",
    }),
    [normalizedSearch, sharedInput],
  );

  const browseOptions = trpc.recipe.getUserRecipes.infiniteQueryOptions(
    sharedInput,
    { getNextPageParam: (lastPage) => lastPage?.nextCursor },
  );
  const searchOptions = trpc.recipe.searchUserRecipes.infiniteQueryOptions(
    searchInput,
    { getNextPageParam: (lastPage) => lastPage?.nextCursor },
  );

  const placeholder = keepPrevious ? { placeholderData: keepPreviousData } : {};
  const browseQuery = useInfiniteQuery({
    ...browseOptions,
    ...placeholder,
    enabled: enabled && !isSearchActive,
  });
  const searchQuery = useInfiniteQuery({
    ...searchOptions,
    ...placeholder,
    enabled: enabled && isSearchActive,
  });

  return isSearchActive ? searchQuery : browseQuery;
};

// Get recipe detail
interface UseRecipeDetailParams {
  recipeId: number | null;
  enabled?: boolean;
}

export const useRecipeDetail = ({
  recipeId,
  enabled = true,
}: UseRecipeDetailParams) => {
  const trpc = useTRPC();

  return useQuery({
    ...trpc.recipe.getRecipeDetail.queryOptions({ recipeId: recipeId ?? -1 }),
    enabled: enabled && recipeId !== null,
  });
};

// Get all tags created by the current user
export const useUserTags = () => {
  const trpc = useTRPC();

  return useQuery({
    ...trpc.recipe.getUserTags.queryOptions(),
  });
};

// Get distinct tags that exist on the current user's recipes
export const useUserRecipeTags = () => {
  const trpc = useTRPC();

  return useQuery({
    ...trpc.recipe.getUserRecipeTags.queryOptions(),
  });
};

// Import a recipe from another user
export const useImportRecipe = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const userId = useSessionContext()?.user.id;

  return useMutation({
    ...trpc.recipe.importRecipe.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries(trpc.recipe.getUserRecipes.pathFilter());
      queryClient.invalidateQueries(trpc.recipe.searchUserRecipes.pathFilter());
      queryClient.invalidateQueries(trpc.activity.getFeed.pathFilter());
      queryClient.invalidateQueries(
        userId
          ? trpc.activity.getUserActivities.infiniteQueryFilter({ userId })
          : trpc.activity.getUserActivities.pathFilter(),
      );
      queryClient.invalidateQueries(trpc.recipe.getRecipeDetail.pathFilter());
      queryClient.invalidateQueries(
        userId
          ? {
              queryKey: trpc.follows.getUserProfile.queryKey({ userId }),
              exact: true,
            }
          : trpc.follows.getUserProfile.pathFilter(),
      );
      queryClient.invalidateQueries(trpc.recipe.getUserTags.pathFilter());
      queryClient.invalidateQueries(trpc.recipe.getUserRecipeTags.pathFilter());
      queryClient.invalidateQueries(
        trpc.collection.getUserCollections.pathFilter(),
      );
      queryClient.invalidateQueries(
        trpc.collection.getCollectionDetail.pathFilter(),
      );
    },
  });
};

// Delete a recipe
export const useDeleteRecipe = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const userId = useSessionContext()?.user.id;

  return useMutation({
    ...trpc.recipe.deleteRecipe.mutationOptions(),
    onSuccess: (_data, variables) => {
      queryClient.removeQueries({
        queryKey: trpc.recipe.getRecipeDetail.queryKey({
          recipeId: variables.recipeId,
        }),
        exact: true,
      });
      queryClient.invalidateQueries(trpc.recipe.getUserRecipes.pathFilter());
      queryClient.invalidateQueries(trpc.recipe.searchUserRecipes.pathFilter());
      queryClient.invalidateQueries(trpc.activity.getFeed.pathFilter());
      queryClient.invalidateQueries(
        userId
          ? trpc.activity.getUserActivities.infiniteQueryFilter({ userId })
          : trpc.activity.getUserActivities.pathFilter(),
      );
      queryClient.invalidateQueries(trpc.activity.getActivity.pathFilter());
      queryClient.invalidateQueries(trpc.recipe.getRecipeDetail.pathFilter());
      queryClient.invalidateQueries(
        userId
          ? {
              queryKey: trpc.follows.getUserProfile.queryKey({ userId }),
              exact: true,
            }
          : trpc.follows.getUserProfile.pathFilter(),
      );
      queryClient.invalidateQueries(trpc.recipe.getUserRecipeTags.pathFilter());
      queryClient.invalidateQueries(
        trpc.collection.getUserCollections.pathFilter(),
      );
      queryClient.invalidateQueries(
        trpc.collection.getCollectionDetail.pathFilter(),
      );
      queryClient.invalidateQueries(trpc.mealPlan.getEntries.pathFilter());
      queryClient.invalidateQueries(trpc.shopping.getShoppingList.pathFilter());
    },
  });
};

// Save a new recipe (used for smart/basic import and manual creation)
export const useSaveRecipe = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const userId = useSessionContext()?.user.id;

  return useMutation({
    ...trpc.recipe.postRecipe.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries(trpc.recipe.getUserRecipes.pathFilter());
      queryClient.invalidateQueries(trpc.recipe.searchUserRecipes.pathFilter());
      queryClient.invalidateQueries(trpc.activity.getFeed.pathFilter());
      queryClient.invalidateQueries(
        userId
          ? trpc.activity.getUserActivities.infiniteQueryFilter({ userId })
          : trpc.activity.getUserActivities.pathFilter(),
      );
      queryClient.invalidateQueries(trpc.recipe.getRecipeDetail.pathFilter());
      queryClient.invalidateQueries(
        userId
          ? {
              queryKey: trpc.follows.getUserProfile.queryKey({ userId }),
              exact: true,
            }
          : trpc.follows.getUserProfile.pathFilter(),
      );
      queryClient.invalidateQueries(trpc.recipe.getUserTags.pathFilter());
      queryClient.invalidateQueries(trpc.recipe.getUserRecipeTags.pathFilter());
      queryClient.invalidateQueries(
        trpc.collection.getUserCollections.pathFilter(),
      );
      queryClient.invalidateQueries(
        trpc.collection.getCollectionDetail.pathFilter(),
      );
    },
  });
};

export const useCompleteRecipeImport = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation({
    ...trpc.recipeImport.complete.mutationOptions(),
    onSuccess: (recipe, variables) => {
      queryClient.setQueryData(
        trpc.recipe.getRecipeDetail.queryKey({ recipeId: recipe.id }),
        recipe,
      );
      queryClient.removeQueries({
        queryKey: trpc.recipeImport.get.queryKey({ id: variables.id }),
        exact: true,
      });
      queryClient.invalidateQueries(trpc.recipe.getUserRecipes.pathFilter());
      queryClient.invalidateQueries(trpc.recipe.searchUserRecipes.pathFilter());
      queryClient.invalidateQueries(trpc.activity.getFeed.pathFilter());
      queryClient.invalidateQueries(
        trpc.activity.getUserActivities.infiniteQueryFilter({
          userId: recipe.owner.id,
        }),
      );
      queryClient.invalidateQueries({
        queryKey: trpc.follows.getUserProfile.queryKey({
          userId: recipe.owner.id,
        }),
        exact: true,
      });
      queryClient.invalidateQueries(trpc.recipe.getUserTags.pathFilter());
      queryClient.invalidateQueries(trpc.recipe.getUserRecipeTags.pathFilter());
      queryClient.invalidateQueries(
        trpc.collection.getUserCollections.pathFilter(),
      );
      queryClient.invalidateQueries(
        trpc.collection.getCollectionDetail.pathFilter(),
      );
      queryClient.invalidateQueries(trpc.recipeImport.list.pathFilter());
    },
  });
};

// Update an existing recipe owned by the current user
export const useUpdateRecipe = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const userId = useSessionContext()?.user.id;

  return useMutation({
    ...trpc.recipe.updateRecipe.mutationOptions(),
    onSuccess: async (_data, variables) => {
      queryClient.invalidateQueries(trpc.recipe.getUserRecipes.pathFilter());
      queryClient.invalidateQueries(trpc.recipe.searchUserRecipes.pathFilter());
      queryClient.invalidateQueries(trpc.activity.getFeed.pathFilter());
      queryClient.invalidateQueries(
        userId
          ? trpc.activity.getUserActivities.infiniteQueryFilter({ userId })
          : trpc.activity.getUserActivities.pathFilter(),
      );
      queryClient.invalidateQueries(trpc.activity.getActivity.pathFilter());
      queryClient.invalidateQueries(trpc.recipe.getUserTags.pathFilter());
      queryClient.invalidateQueries(trpc.recipe.getUserRecipeTags.pathFilter());
      queryClient.invalidateQueries(
        trpc.collection.getUserCollections.pathFilter(),
      );
      queryClient.invalidateQueries(
        trpc.collection.getCollectionDetail.pathFilter(),
      );
      queryClient.invalidateQueries(trpc.mealPlan.getEntries.pathFilter());

      await queryClient.invalidateQueries({
        queryKey: trpc.recipe.getRecipeDetail.queryKey({
          recipeId: variables.recipeId,
        }),
        exact: true,
      });
    },
  });
};

// Personalise a recipe with AI and return an editable parsed recipe preview
export const usePersonalizeRecipe = () => {
  const trpc = useTRPC();

  return useMutation(
    trpc.recipeAi.personalizeRecipe.mutationOptions({
      retry: false,
    }),
  );
};

export const useGenerateRecipeImage = () => {
  const trpc = useTRPC();

  return useMutation(
    trpc.recipeAi.generateRecipeImage.mutationOptions({
      retry: false,
    }),
  );
};

export const useGetRecipeNutrition = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation({
    ...trpc.recipeAi.getNutrition.mutationOptions({
      retry: false,
    }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: trpc.recipe.getRecipeDetail.queryKey({
          recipeId: variables.recipeId,
        }),
        exact: true,
      });
    },
  });
};
