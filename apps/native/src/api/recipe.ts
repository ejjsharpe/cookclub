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
  NonNullable<Outputs["recipeImport"]["get"]["recipe"]>,
  { success: true }
>;
export type PersonalizationGoal =
  Inputs["recipeAi"]["personalizeRecipe"]["goals"][number];

type RecipeTRPC = ReturnType<typeof useTRPC>;
type RecipeQueryClient = ReturnType<typeof useQueryClient>;

async function invalidateUserRecipeLists(
  queryClient: RecipeQueryClient,
  trpc: RecipeTRPC,
) {
  await Promise.all([
    queryClient.invalidateQueries(trpc.recipe.getUserRecipes.pathFilter()),
    queryClient.invalidateQueries(trpc.recipe.searchUserRecipes.pathFilter()),
  ]);
}

async function invalidateRecipeActivityQueries(
  queryClient: RecipeQueryClient,
  trpc: RecipeTRPC,
) {
  await Promise.all([
    queryClient.invalidateQueries(trpc.activity.getFeed.pathFilter()),
    queryClient.invalidateQueries(trpc.activity.getUserActivities.pathFilter()),
    queryClient.invalidateQueries(trpc.activity.getActivity.pathFilter()),
  ]);
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
    onSuccess: async () => {
      await Promise.all([
        invalidateUserRecipeLists(queryClient, trpc),
        invalidateRecipeActivityQueries(queryClient, trpc),
        queryClient.invalidateQueries(trpc.recipe.getRecipeDetail.pathFilter()),
        queryClient.invalidateQueries(trpc.recipe.getUserTags.pathFilter()),
        queryClient.invalidateQueries(
          trpc.recipe.getUserRecipeTags.pathFilter(),
        ),
        queryClient.invalidateQueries(
          trpc.recipe.getUserPreferences.pathFilter(),
        ),
        queryClient.invalidateQueries(
          trpc.recipe.getPopularThisWeek.pathFilter(),
        ),
        queryClient.invalidateQueries(
          trpc.collection.getUserCollections.pathFilter(),
        ),
        queryClient.invalidateQueries(
          trpc.collection.getCollectionDetail.pathFilter(),
        ),
        queryClient.invalidateQueries(trpc.follows.getUserProfile.pathFilter()),
      ]);
    },
  });
};

// Delete a recipe
export const useDeleteRecipe = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation({
    ...trpc.recipe.deleteRecipe.mutationOptions(),
    onSuccess: async (_data, variables) => {
      queryClient.removeQueries(
        trpc.recipe.getRecipeDetail.queryFilter({
          recipeId: variables.recipeId,
        }),
      );
      await Promise.all([
        invalidateUserRecipeLists(queryClient, trpc),
        invalidateRecipeActivityQueries(queryClient, trpc),
        queryClient.invalidateQueries(trpc.recipe.getUserTags.pathFilter()),
        queryClient.invalidateQueries(
          trpc.recipe.getUserRecipeTags.pathFilter(),
        ),
        queryClient.invalidateQueries(
          trpc.recipe.getUserPreferences.pathFilter(),
        ),
        queryClient.invalidateQueries(
          trpc.recipe.getPopularThisWeek.pathFilter(),
        ),
        queryClient.invalidateQueries(
          trpc.collection.getUserCollections.pathFilter(),
        ),
        queryClient.invalidateQueries(
          trpc.collection.getCollectionDetail.pathFilter(),
        ),
        queryClient.invalidateQueries(trpc.mealPlan.getEntries.pathFilter()),
        queryClient.invalidateQueries(
          trpc.shopping.getShoppingList.pathFilter(),
        ),
        queryClient.invalidateQueries(trpc.follows.getUserProfile.pathFilter()),
      ]);
    },
  });
};

// Save a new recipe (used for smart/basic import and manual creation)
export const useSaveRecipe = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation({
    ...trpc.recipe.postRecipe.mutationOptions(),
    onSuccess: async () => {
      await Promise.all([
        invalidateUserRecipeLists(queryClient, trpc),
        invalidateRecipeActivityQueries(queryClient, trpc),
        queryClient.invalidateQueries(trpc.recipe.getRecipeDetail.pathFilter()),
        queryClient.invalidateQueries(trpc.recipe.getUserTags.pathFilter()),
        queryClient.invalidateQueries(
          trpc.recipe.getUserRecipeTags.pathFilter(),
        ),
        queryClient.invalidateQueries(
          trpc.recipe.getUserPreferences.pathFilter(),
        ),
        queryClient.invalidateQueries(
          trpc.recipe.getPopularThisWeek.pathFilter(),
        ),
        queryClient.invalidateQueries(
          trpc.collection.getUserCollections.pathFilter(),
        ),
        queryClient.invalidateQueries(
          trpc.collection.getCollectionDetail.pathFilter(),
        ),
        queryClient.invalidateQueries(trpc.follows.getUserProfile.pathFilter()),
      ]);
    },
  });
};

export const useCompleteRecipeImport = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation({
    ...trpc.recipeImport.complete.mutationOptions(),
    onSuccess: async () => {
      await Promise.all([
        invalidateUserRecipeLists(queryClient, trpc),
        invalidateRecipeActivityQueries(queryClient, trpc),
        queryClient.invalidateQueries(trpc.recipe.getRecipeDetail.pathFilter()),
        queryClient.invalidateQueries(trpc.recipe.getUserTags.pathFilter()),
        queryClient.invalidateQueries(
          trpc.recipe.getUserRecipeTags.pathFilter(),
        ),
        queryClient.invalidateQueries(
          trpc.recipe.getUserPreferences.pathFilter(),
        ),
        queryClient.invalidateQueries(
          trpc.recipe.getPopularThisWeek.pathFilter(),
        ),
        queryClient.invalidateQueries(
          trpc.collection.getUserCollections.pathFilter(),
        ),
        queryClient.invalidateQueries(
          trpc.collection.getCollectionDetail.pathFilter(),
        ),
        queryClient.invalidateQueries(trpc.recipeImport.list.pathFilter()),
        queryClient.invalidateQueries(trpc.recipeImport.get.pathFilter()),
        queryClient.invalidateQueries(trpc.follows.getUserProfile.pathFilter()),
      ]);
    },
  });
};

// Update an existing recipe owned by the current user
export const useUpdateRecipe = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation({
    ...trpc.recipe.updateRecipe.mutationOptions(),
    onSuccess: async () => {
      await Promise.all([
        invalidateUserRecipeLists(queryClient, trpc),
        invalidateRecipeActivityQueries(queryClient, trpc),
        queryClient.invalidateQueries(trpc.recipe.getRecipeDetail.pathFilter()),
        queryClient.invalidateQueries(trpc.recipe.getUserTags.pathFilter()),
        queryClient.invalidateQueries(
          trpc.recipe.getUserRecipeTags.pathFilter(),
        ),
        queryClient.invalidateQueries(
          trpc.recipe.getUserPreferences.pathFilter(),
        ),
        queryClient.invalidateQueries(
          trpc.recipe.getPopularThisWeek.pathFilter(),
        ),
        queryClient.invalidateQueries(
          trpc.collection.getUserCollections.pathFilter(),
        ),
        queryClient.invalidateQueries(
          trpc.collection.getCollectionDetail.pathFilter(),
        ),
        queryClient.invalidateQueries(trpc.mealPlan.getEntries.pathFilter()),
        queryClient.invalidateQueries(
          trpc.shopping.getShoppingList.pathFilter(),
        ),
      ]);
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
      queryClient.invalidateQueries(
        trpc.recipe.getRecipeDetail.queryFilter({
          recipeId: variables.recipeId,
        }),
      );
    },
  });
};
