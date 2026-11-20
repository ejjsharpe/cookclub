import { useState } from "react";

import { useCollectionData } from "./useCollectionData";
import { useDebounce } from "./useDebounce";
import { useRecipeData } from "./useRecipeData";
import { useRecipeFilters } from "./useRecipeFilters";

export type { Recipe } from "./useRecipeData";
export type { CollectionWithMetadata } from "./useCollectionData";

/** Your recipes and collections, searched and filtered together. */
export const useRecipeCollectionBrowser = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebounce(searchQuery, 250);

  const {
    hasActiveFilters,
    parsedTagIds,
    parsedMaxTotalTime,
    selectedTagIds,
    setSelectedTagIds,
    maxTotalTime,
    setMaxTotalTime,
    clearFilters,
    allTags,
  } = useRecipeFilters();

  const {
    recipes,
    isPending: isPendingRecipes,
    error: recipesError,
    isFetchingNext: isFetchingNextRecipes,
    hasMore: hasMoreRecipes,
    handleLoadMore: handleLoadMoreRecipes,
  } = useRecipeData({
    search: debouncedSearchQuery,
    tagIds: parsedTagIds,
    maxTotalTime: parsedMaxTotalTime,
  });

  const {
    collections,
    isPending: isPendingCollections,
    error: collectionsError,
  } = useCollectionData({
    search: debouncedSearchQuery,
  });

  return {
    // Search
    searchQuery,
    setSearchQuery,

    // Filters
    hasActiveFilters,
    clearFilters,
    filterSheetProps: {
      selectedTagIds,
      onTagsChange: setSelectedTagIds,
      maxTotalTime,
      onTimeChange: setMaxTotalTime,
      allTags,
    },

    // Recipes
    recipes,
    isPendingRecipes,
    recipesError,
    isFetchingNextRecipes,
    hasMoreRecipes,
    handleLoadMoreRecipes,

    // Collections
    collections,
    isPendingCollections,
    collectionsError,
  };
};
