import { memo, useCallback, useEffect, useRef, useMemo } from "react";
import { View, Dimensions } from "react-native";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
  type AnimatedRef,
} from "react-native-reanimated";
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";

import {
  CollectionGrid,
  type CollectionGridRef,
  type CollectionListItem,
} from "./CollectionGrid";
import { CollectionGridCard } from "./CollectionGridCard";
import { FilterSheet, type FilterSheetRef } from "./FilterBottomSheet";
import { RecipeCard } from "./RecipeCard";
import {
  RecipeCollectionHeader,
  HEADER_CONTENT_HEIGHT,
} from "./RecipeCollectionHeader";
import { RecipeList, type RecipeListRef } from "./RecipeList";
import { MyRecipesListSkeleton, CollectionsListSkeleton } from "./Skeleton";
import { SwipeableTabView } from "./SwipeableTabView";
import { Text } from "./Text";

import {
  useRecipeCollectionBrowser,
  type Recipe,
  type CollectionWithMetadata,
  type TabType,
} from "@/hooks/useRecipeCollectionBrowser";

// Re-export types for consumers
export type { Recipe, CollectionWithMetadata, TabType };

const { width: SCREEN_WIDTH } = Dimensions.get("window");
export const SEARCH_RESULTS_CROSSFADE_START = 0.6;
const ADDITIONAL_RECIPE_FADE_START = 0.4;

interface AnimatedRecipeResultProps {
  recipe: Recipe;
  index: number;
  transitionRecipeCount: number;
  animationProgress?: SharedValue<number>;
  onRecipePress: (recipeId: number) => void;
}

const AnimatedRecipeResult = memo(function AnimatedRecipeResult({
  recipe,
  index,
  transitionRecipeCount,
  animationProgress,
  onRecipePress,
}: AnimatedRecipeResultProps) {
  const animatedStyle = useAnimatedStyle(() => {
    "worklet";
    if (!animationProgress) {
      return {};
    }

    const progress = animationProgress.get();
    if (index < transitionRecipeCount) {
      return { opacity: progress >= 1 ? 1 : 0 };
    }

    const fadeProgress = interpolate(
      progress,
      [0, ADDITIONAL_RECIPE_FADE_START, 1],
      [0, 0, 1],
      Extrapolation.CLAMP,
    );

    return {
      // The browser's parent also fades by progress. Compensate here so the
      // visible result follows fadeProgress rather than progress squared.
      opacity: progress > 0 ? Math.min(1, fadeProgress / progress) : 0,
    };
  });

  return (
    <Animated.View style={animatedStyle}>
      <RecipeCard recipe={recipe} onPressRecipeId={onRecipePress} />
    </Animated.View>
  );
});

interface RecipeCollectionBrowserProps {
  onRecipePress: (recipeId: number) => void;
  onCollectionPress: (collectionId: number) => void;
  showCreateCollectionCard?: boolean;
  onCreateCollection?: () => void;
  isCreatingCollection?: boolean;
  recipesEmptyMessage?: string;
  /** Hide the search bar (when using external search bar) */
  hideSearchBar?: boolean;
  /** External search query to sync with internal state */
  externalSearchQuery?: string;
  /** Callback when internal search query changes */
  onSearchQueryChange?: (query: string) => void;
  /** Callback to receive filter state for external filter button rendering */
  onFilterStateChange?: (state: {
    hasActiveFilters: boolean;
    onOpenFilters: () => void;
    clearFilters: () => void;
    activeTab: TabType;
  }) => void;
  /** Animation progress for header entrance (0 = hidden, 1 = visible) */
  headerAnimationProgress?: SharedValue<number>;
  /** Number of leading recipes represented by moving transition clones */
  transitionRecipeCount?: number;
  /** Initial tab to display */
  initialTab?: TabType;
  /** Ref attached to the first collection item for position measurement */
  firstCollectionRef?: AnimatedRef<Animated.View>;
  /** Whether the browser is currently active/visible - used to reset scroll on exit */
  isActive?: boolean;
}

export const RecipeCollectionBrowser = ({
  onRecipePress,
  onCollectionPress,
  showCreateCollectionCard = false,
  onCreateCollection,
  isCreatingCollection = false,
  recipesEmptyMessage = "No recipes in your library yet",
  hideSearchBar = false,
  externalSearchQuery,
  onSearchQueryChange,
  onFilterStateChange,
  headerAnimationProgress,
  transitionRecipeCount = 0,
  initialTab,
  firstCollectionRef,
  isActive,
}: RecipeCollectionBrowserProps) => {
  const filterSheetRef = useRef<FilterSheetRef>(null);
  const recipeListRef = useRef<RecipeListRef>(null);
  const collectionGridRef = useRef<CollectionGridRef>(null);
  const wasActive = useRef(isActive);

  // Reset scroll when exiting active state (so lists are at top when re-entering)
  useEffect(() => {
    if (!isActive && wasActive.current) {
      recipeListRef.current?.scrollToTop();
      collectionGridRef.current?.scrollToTop();
    }
    wasActive.current = isActive;
  }, [isActive]);

  const {
    activeTab,
    activeTabIndex,
    scrollProgress,
    switchTab,
    handleSwipeTabChange,
    searchQuery,
    setSearchQuery,
    hasActiveFilters,
    clearFilters,
    filterButtonStyle,
    filterSheetProps,
    recipes,
    isPendingRecipes,
    recipesError,
    isFetchingNextRecipes,
    handleLoadMoreRecipes,
    collections,
    isPendingCollections,
    collectionsError,
    isRefreshing,
    handleRefresh,
  } = useRecipeCollectionBrowser({
    externalSearchQuery,
    initialTab,
  });

  const handleOpenFilters = useCallback(() => {
    filterSheetRef.current?.present();
  }, []);

  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();

  const centeredKeyboardStyle = useAnimatedStyle(() => {
    const keyboardOffset = Math.max(0, -keyboardHeight.get());

    return {
      // Bottom padding moved centered content up by half the keyboard height,
      // but forced Yoga to relayout the off-screen tab on every keyboard frame.
      // The equivalent transform keeps the same position without layout work.
      transform: [{ translateY: -keyboardOffset / 2 }],
    };
  });

  // Sync search query changes with parent if callback provided
  const handleSearchChange = useCallback(
    (query: string) => {
      setSearchQuery(query);
      onSearchQueryChange?.(query);
    },
    [setSearchQuery, onSearchQueryChange],
  );

  // Notify parent of filter state changes
  useEffect(() => {
    onFilterStateChange?.({
      hasActiveFilters,
      onOpenFilters: handleOpenFilters,
      clearFilters,
      activeTab,
    });
  }, [
    onFilterStateChange,
    hasActiveFilters,
    handleOpenFilters,
    clearFilters,
    activeTab,
  ]);

  // Crossfade the real results in as the moving clones settle into place.
  // Compensate for the parent search view's opacity so the combined on-screen
  // opacity follows the crossfade rather than multiplying by progress twice.
  const collectionsEntranceStyle = useAnimatedStyle(() => {
    "worklet";
    if (!headerAnimationProgress) {
      return {};
    }

    const progress = headerAnimationProgress.get();
    const crossfadeProgress = interpolate(
      progress,
      [0, SEARCH_RESULTS_CROSSFADE_START, 1],
      [0, 0, 1],
      Extrapolation.CLAMP,
    );

    return {
      opacity: progress > 0 ? Math.min(1, crossfadeProgress / progress) : 0,
    };
  });

  const insets = UnistylesRuntime.insets;
  const headerPaddingTop = insets.top + HEADER_CONTENT_HEIGHT;
  const centeredStateStyle = useMemo(
    () => [
      styles.centered,
      { paddingTop: headerPaddingTop },
      centeredKeyboardStyle,
    ],
    [headerPaddingTop, centeredKeyboardStyle],
  );

  // Render item callbacks
  const renderRecipe = useCallback(
    ({ item, index }: { item: Recipe; index: number }) => (
      <AnimatedRecipeResult
        recipe={item}
        index={index}
        transitionRecipeCount={transitionRecipeCount}
        animationProgress={headerAnimationProgress}
        onRecipePress={onRecipePress}
      />
    ),
    [headerAnimationProgress, onRecipePress, transitionRecipeCount],
  );

  const renderCollection = useCallback(
    ({ item }: { item: CollectionListItem }) => {
      // Create card is handled internally by CollectionGrid
      if ("type" in item && item.type === "create") {
        return null;
      }
      const collection = item as CollectionWithMetadata;
      return (
        <CollectionGridCard
          collection={collection}
          onPressCollection={onCollectionPress}
        />
      );
    },
    [onCollectionPress],
  );

  const recipesContent = useMemo(() => {
    if (isPendingRecipes) {
      return (
        <View style={[styles.stateContainer, { paddingTop: headerPaddingTop }]}>
          <MyRecipesListSkeleton />
        </View>
      );
    }

    if (recipesError) {
      return (
        <Animated.View style={centeredStateStyle}>
          <Text type="subheadline" style={styles.centeredText}>
            Failed to load recipes
          </Text>
        </Animated.View>
      );
    }

    if (recipes.length === 0) {
      const hasSearchQuery = searchQuery.trim().length > 0;
      const emptyMessage = hasSearchQuery
        ? hasActiveFilters
          ? "No recipes match your search and filters"
          : "No recipes found for your search"
        : hasActiveFilters
          ? "No recipes match your filters"
          : recipesEmptyMessage;

      return (
        <Animated.View style={centeredStateStyle}>
          <Text type="subheadline" style={styles.centeredText}>
            {emptyMessage}
          </Text>
        </Animated.View>
      );
    }

    return (
      <RecipeList
        ref={recipeListRef}
        recipes={recipes}
        renderItem={renderRecipe}
        onLoadMore={handleLoadMoreRecipes}
        isFetchingMore={isFetchingNextRecipes}
        isRefreshing={isRefreshing}
        onRefresh={handleRefresh}
        headerHeight={HEADER_CONTENT_HEIGHT}
      />
    );
  }, [
    isPendingRecipes,
    recipesError,
    recipes,
    searchQuery,
    hasActiveFilters,
    recipesEmptyMessage,
    centeredStateStyle,
    renderRecipe,
    handleLoadMoreRecipes,
    isFetchingNextRecipes,
    isRefreshing,
    handleRefresh,
  ]);

  const collectionsContent = useMemo(() => {
    if (isPendingCollections) {
      return (
        <View style={[styles.stateContainer, { paddingTop: headerPaddingTop }]}>
          <CollectionsListSkeleton />
        </View>
      );
    }

    if (collectionsError) {
      return (
        <Animated.View style={centeredStateStyle}>
          <Text type="subheadline" style={styles.centeredText}>
            Failed to load collections
          </Text>
        </Animated.View>
      );
    }

    // Show empty state only if not showing create card
    if (collections.length === 0 && !showCreateCollectionCard) {
      return (
        <Animated.View style={centeredStateStyle}>
          <Text type="subheadline" style={styles.centeredText}>
            {searchQuery
              ? "No collections found for your search"
              : "No collections yet"}
          </Text>
        </Animated.View>
      );
    }

    return (
      <CollectionGrid
        ref={collectionGridRef}
        collections={collections}
        renderItem={renderCollection}
        showCreateCard={showCreateCollectionCard}
        onCreateCollection={onCreateCollection}
        isCreatingCollection={isCreatingCollection}
        isRefreshing={isRefreshing}
        onRefresh={handleRefresh}
        headerHeight={HEADER_CONTENT_HEIGHT}
        firstItemRef={firstCollectionRef}
      />
    );
  }, [
    isPendingCollections,
    collectionsError,
    collections,
    searchQuery,
    showCreateCollectionCard,
    headerPaddingTop,
    centeredStateStyle,
    renderCollection,
    onCreateCollection,
    isCreatingCollection,
    isRefreshing,
    handleRefresh,
    firstCollectionRef,
  ]);

  return (
    <View style={styles.container}>
      <View style={styles.listWrapper}>
        <SwipeableTabView
          activeIndex={activeTabIndex}
          onIndexChange={handleSwipeTabChange}
          containerWidth={SCREEN_WIDTH}
          scrollProgress={scrollProgress}
        >
          {recipesContent}
          <Animated.View style={[styles.listWrapper, collectionsEntranceStyle]}>
            {collectionsContent}
          </Animated.View>
        </SwipeableTabView>
      </View>
      <RecipeCollectionHeader
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        hideSearchBar={hideSearchBar}
        activeTab={activeTab}
        onTabChange={switchTab}
        scrollProgress={scrollProgress}
        hasActiveFilters={hasActiveFilters}
        onOpenFilters={handleOpenFilters}
        filterButtonStyle={filterButtonStyle}
        isActive={isActive}
      />

      {/* Filter Sheet */}
      <FilterSheet ref={filterSheetRef} {...filterSheetProps} />
    </View>
  );
};

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  listWrapper: {
    flex: 1,
  },
  stateContainer: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  centeredText: {
    textAlign: "center",
    color: theme.colors.textSecondary,
  },
}));
