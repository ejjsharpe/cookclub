import { useCallback, useState } from "react";

import { useCollectionData } from "./useCollectionData";
import { useDebounce } from "./useDebounce";
import { useRecipeData } from "./useRecipeData";
import { useRecipeFilters } from "./useRecipeFilters";
import { useTabNavigation, type TabType } from "./useTabNavigation";

// Re-export types for consumers
export type { Recipe } from "./useRecipeData";
export type { CollectionWithMetadata } from "./useCollectionData";
export type { TabType } from "./useTabNavigation";

export const useRecipeCollectionBrowser = () => {
  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebounce(searchQuery, 250);

  // Compose tab navigation
  const {
    activeTab,
    activeTabIndex,
    scrollProgress,
    switchTab: baseSwitchTab,
  } = useTabNavigation();

  // Compose filters with tab-aware animation
  const {
    hasActiveFilters,
    filterButtonProgress,
    filterButtonStyle,
    searchBarWrapperStyle,
    parsedTagIds,
    parsedMaxTotalTime,
    setFilterButtonVisible,
    // Filter sheet props
    selectedTagIds,
    setSelectedTagIds,
    maxTotalTime,
    setMaxTotalTime,
    clearFilters,
    allTags,
  } = useRecipeFilters();

  // Override switchTab to also animate filter button
  const switchTab = useCallback(
    (tab: TabType) => {
      baseSwitchTab(tab);
      setFilterButtonVisible(tab === "recipes");
    },
    [baseSwitchTab, setFilterButtonVisible],
  );

  const handleSwipeTabChange = useCallback(
    (index: number) => {
      const tab = index === 0 ? "recipes" : "collections";
      switchTab(tab);
    },
    [switchTab],
  );

  // Compose recipe data
  const {
    recipes,
    isPending: isPendingRecipes,
    error: recipesError,
    isFetchingNext: isFetchingNextRecipes,
    hasMore: hasMoreRecipes,
    handleLoadMore: handleLoadMoreRecipes,
    refetch: refetchRecipes,
  } = useRecipeData({
    search: debouncedSearchQuery,
    tagIds: parsedTagIds,
    maxTotalTime: parsedMaxTotalTime,
  });

  // Compose collection data
  const {
    collections,
    isPending: isPendingCollections,
    error: collectionsError,
    refetch: refetchCollections,
  } = useCollectionData({
    search: debouncedSearchQuery,
  });

  // Coordinated refresh
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await Promise.all([refetchRecipes(), refetchCollections()]);
    setIsRefreshing(false);
  }, [refetchRecipes, refetchCollections]);

  return {
    // Tab state
    activeTab,
    activeTabIndex,
    scrollProgress,
    switchTab,
    handleSwipeTabChange,

    // Search
    searchQuery,
    setSearchQuery,

    // Filters
    hasActiveFilters,
    clearFilters,

    // Filter button animation
    filterButtonProgress,
    filterButtonStyle,
    searchBarWrapperStyle,

    // Filter sheet props (for rendering FilterSheet)
    filterSheetProps: {
      selectedTagIds,
      onTagsChange: setSelectedTagIds,
      maxTotalTime,
      onTimeChange: setMaxTotalTime,
      allTags,
    },

    // Recipes data
    recipes,
    isPendingRecipes,
    recipesError,
    isFetchingNextRecipes,
    hasMoreRecipes,
    handleLoadMoreRecipes,

    // Collections data
    collections,
    isPendingCollections,
    collectionsError,

    // Refresh
    isRefreshing,
    handleRefresh,
  };
};
