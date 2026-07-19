import { MIN_RECIPE_SEARCH_LENGTH } from "@repo/shared";
import type { Inputs, Outputs } from "@repo/trpc/client";
import { useTRPC } from "@repo/trpc/client";
import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useMemo } from "react";

// API Response Types
export type Recipe = Outputs["recipe"]["getRecipeDetail"];
export type RecipeListItem =
  Outputs["recipe"]["getUserRecipes"]["items"][number];
export type ParsedRecipe = Extract<
  NonNullable<Outputs["recipe"]["listImportJobs"][number]["recipe"]>,
  { success: true }
>;
export type PersonalizationGoal =
  Inputs["recipe"]["personalizeRecipe"]["goals"][number];

type RecipeTRPC = ReturnType<typeof useTRPC>;
type RecipeQueryClient = ReturnType<typeof useQueryClient>;

function invalidateUserRecipeLists(
  queryClient: RecipeQueryClient,
  trpc: RecipeTRPC,
) {
  queryClient.invalidateQueries(trpc.recipe.getUserRecipes.pathFilter());
  queryClient.invalidateQueries(trpc.recipe.searchUserRecipes.pathFilter());
}

interface UseGetUserRecipesParams {
  search?: string;
  limit?: number;
  tagIds?: number[];
  maxTotalTime?: number;
}

export const useGetUserRecipes = ({
  search,
  limit = 20,
  tagIds,
  maxTotalTime,
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

  const sharedInput = useMemo(
    () => ({
      limit,
      ...(normalizedTagIds ? { tagIds: normalizedTagIds } : {}),
      ...(normalizedMaxTotalTime != null
        ? { maxTotalTime: normalizedMaxTotalTime }
        : {}),
    }),
    [limit, normalizedTagIds, normalizedMaxTotalTime],
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

  const browseQuery = useInfiniteQuery({
    ...browseOptions,
    enabled: !isSearchActive,
  });
  const searchQuery = useInfiniteQuery({
    ...searchOptions,
    enabled: isSearchActive,
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

  return useMutation({
    ...trpc.recipe.importRecipe.mutationOptions(),
    onSuccess: () => {
      // Invalidate user's recipe list to show the imported recipe
      invalidateUserRecipeLists(queryClient, trpc);
      // Invalidate recipe detail queries (user may view their new copy)
      queryClient.invalidateQueries(trpc.recipe.getRecipeDetail.pathFilter());
      queryClient.invalidateQueries(trpc.recipe.getUserTags.pathFilter());
      queryClient.invalidateQueries(trpc.recipe.getUserRecipeTags.pathFilter());
      // Invalidate collection queries (recipe is auto-added to "Want to cook")
      queryClient.invalidateQueries(
        trpc.collection.getUserCollections.pathFilter(),
      );
    },
  });
};

// Delete a recipe
export const useDeleteRecipe = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation({
    ...trpc.recipe.deleteRecipe.mutationOptions(),
    onSuccess: () => {
      // Invalidate user's recipe list to remove the deleted recipe
      invalidateUserRecipeLists(queryClient, trpc);
      // Invalidate recipe detail queries
      queryClient.invalidateQueries(trpc.recipe.getRecipeDetail.pathFilter());
      queryClient.invalidateQueries(trpc.recipe.getUserTags.pathFilter());
      queryClient.invalidateQueries(trpc.recipe.getUserRecipeTags.pathFilter());
      // Invalidate collection queries (recipe counts may have changed)
      queryClient.invalidateQueries(
        trpc.collection.getUserCollections.pathFilter(),
      );
    },
  });
};

// Save a new recipe (used for smart/basic import and manual creation)
export const useSaveRecipe = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation({
    ...trpc.recipe.postRecipe.mutationOptions(),
    onSuccess: () => {
      // Invalidate user's recipe list to show the new recipe
      invalidateUserRecipeLists(queryClient, trpc);
      // Invalidate recipe detail queries
      queryClient.invalidateQueries(trpc.recipe.getRecipeDetail.pathFilter());
      queryClient.invalidateQueries(trpc.recipe.getUserTags.pathFilter());
      queryClient.invalidateQueries(trpc.recipe.getUserRecipeTags.pathFilter());
      // Invalidate collection queries (recipe is auto-added to default collection)
      queryClient.invalidateQueries(
        trpc.collection.getUserCollections.pathFilter(),
      );
      // Invalidate collection detail queries (recipe counts change)
      queryClient.invalidateQueries(
        trpc.collection.getCollectionDetail.pathFilter(),
      );
    },
  });
};

// Update an existing recipe owned by the current user
export const useUpdateRecipe = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation({
    ...trpc.recipe.updateRecipe.mutationOptions(),
    onSuccess: () => {
      invalidateUserRecipeLists(queryClient, trpc);
      queryClient.invalidateQueries(trpc.recipe.getRecipeDetail.pathFilter());
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

// Personalise a recipe with AI and return an editable parsed recipe preview
export const usePersonalizeRecipe = () => {
  const trpc = useTRPC();

  return useMutation(
    trpc.recipe.personalizeRecipe.mutationOptions({
      retry: false,
    }),
  );
};

export const useGenerateRecipeImage = () => {
  const trpc = useTRPC();

  return useMutation(
    trpc.recipe.generateRecipeImage.mutationOptions({
      retry: false,
    }),
  );
};

export const useGetRecipeNutrition = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation({
    ...trpc.recipe.getNutrition.mutationOptions({
      retry: false,
    }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries(
        trpc.recipe.getRecipeDetail.queryFilter({
          recipeId: variables.recipeId,
        }),
      );
    },
  });
};
