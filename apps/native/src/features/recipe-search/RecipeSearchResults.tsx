import { useNavigation } from "@react-navigation/native";
import { MIN_RECIPE_SEARCH_LENGTH } from "@repo/shared";
import { FlashList } from "@shopify/flash-list";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, {
  interpolate,
  useAnimatedStyle,
} from "react-native-reanimated";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { RecentSearchRow, SearchRowTile } from "./RecentSearchRow";
import { RecipeSortMenu } from "./RecipeSortMenu";
import { activeFilterCount, sortOptions } from "./recipeSearchFilters";
import type { RecipeSearchFilters } from "./recipeSearchFilters";
import { addTag, matchingTags, type SearchTag } from "./searchTokens";

import { ImageGrid } from "@/components/CollectionGridCard";
import { Ionicons } from "@/components/Ionicons";
import { RecipeCard } from "@/components/RecipeCard";
import { Text } from "@/components/Text";
import {
  useCollectionData,
  type CollectionWithMetadata,
} from "@/hooks/useCollectionData";
import { useRecipeData, type Recipe } from "@/hooks/useRecipeData";
import {
  addRecentRecipeSearch,
  clearRecentRecipeSearches,
  recentRecipeSearchKey,
  removeRecentRecipeSearch,
  useRecentRecipeSearches,
  type RecentRecipeSearch,
} from "@/lib/recentRecipeSearches";

const H_PAD = 20;
/** Collections are a shortcut, so only the closest few are offered. */
const MAX_COLLECTIONS = 3;
const TILE = 52;

type Row =
  | { kind: "heading"; key: string; title: string; clearable?: boolean }
  | { kind: "recent"; item: RecentRecipeSearch }
  | { kind: "tag"; tag: SearchTag }
  | { kind: "collection"; collection: CollectionWithMetadata }
  | { kind: "moreCollections"; count: number }
  | { kind: "recipesHeading" }
  | { kind: "recipe"; recipe: Recipe }
  | { kind: "message"; title: string; body: string }
  | { kind: "loading" };

function rowKey(row: Row): string {
  switch (row.kind) {
    case "heading":
      return `heading:${row.key}`;
    case "recent":
      return `recent:${recentRecipeSearchKey(row.item)}`;
    case "tag":
      return `tag:${row.tag.id}`;
    case "collection":
      return `collection:${row.collection.id}`;
    case "recipe":
      return `recipe:${row.recipe.id}`;
    default:
      return row.kind;
  }
}

interface RecipeSearchResultsProps {
  /** What's in the field right now, for instant tag matches. */
  query: string;
  /** The same, debounced, for server searches. */
  debouncedQuery: string;
  filters: RecipeSearchFilters;
  onFiltersChange: (
    update: (filters: RecipeSearchFilters) => RecipeSearchFilters,
  ) => void;
  onQueryChange: (query: string) => void;
  tags: SearchTag[];
  /** Height of the chips and field floating over the bottom of the list. */
  stackHeight: number;
  /** Gap under that stack: above the tab bar, and above the keyboard. */
  restingGap: number;
  keyboardGap: number;
}

/**
 * What library search shows above the field: recent searches until you type,
 * then matching tags and collections, then recipes.
 */
export const RecipeSearchResults = ({
  query,
  debouncedQuery,
  filters,
  onFiltersChange,
  onQueryChange,
  tags,
  stackHeight,
  restingGap,
  keyboardGap,
}: RecipeSearchResultsProps) => {
  const navigation = useNavigation();
  const { theme, rt } = useUnistyles();
  const recents = useRecentRecipeSearches();
  // Which search "Show all" was tapped for, so a new search starts capped.
  const [allCollectionsFor, setAllCollectionsFor] = useState<string | null>(
    null,
  );
  const { height: keyboardHeight, progress: keyboardProgress } =
    useReanimatedKeyboardAnimation();

  const trimmed = debouncedQuery.trim();
  const typing = query.trim() !== "";
  const hasQuery = trimmed.length >= MIN_RECIPE_SEARCH_LENGTH;
  const isNarrowed =
    activeFilterCount(filters) > 0 || filters.sort !== "default";
  const showRecipes = hasQuery || isNarrowed;
  // Typed enough to search, but the debounce hasn't caught up yet.
  const waiting =
    query.trim().length >= MIN_RECIPE_SEARCH_LENGTH && query.trim() !== trimmed;
  // Collections aren't tagged or timed, so they'd ignore any filter.
  const showCollections = hasQuery && activeFilterCount(filters) === 0;
  const allCollections = allCollectionsFor === trimmed;

  const recipeData = useRecipeData({
    search: debouncedQuery,
    tagIds: filters.tagIds,
    sort: filters.sort,
    ...(filters.maxTotalTime == null
      ? {}
      : { maxTotalTime: filters.maxTotalTime }),
    ...(filters.source ? { source: filters.source } : {}),
    enabled: showRecipes,
  });
  const collectionData = useCollectionData({
    search: trimmed,
    enabled: showCollections,
  });

  const tagMatches = useMemo(
    () => matchingTags(query, tags, filters.tagIds),
    [query, tags, filters.tagIds],
  );

  const rows = useMemo<Row[]>(() => {
    if (!typing && !isNarrowed) {
      if (recents.length === 0) {
        return [
          {
            kind: "message",
            title: "Search your library",
            body: "Find recipes by name or ingredient, or tap a chip to narrow them down.",
          },
        ];
      }
      return [
        { kind: "heading", key: "recent", title: "Recent", clearable: true },
        ...recents.map((item): Row => ({ kind: "recent", item })),
      ];
    }

    const result: Row[] = [];
    if (tagMatches.length > 0) {
      result.push({ kind: "heading", key: "tags", title: "Tags" });
      for (const tag of tagMatches) result.push({ kind: "tag", tag });
    }
    const matching = showCollections ? collectionData.collections : [];
    const collections = allCollections
      ? matching
      : matching.slice(0, MAX_COLLECTIONS);
    if (collections.length > 0) {
      result.push({
        kind: "heading",
        key: "collections",
        title: "Collections",
      });
      for (const collection of collections) {
        result.push({ kind: "collection", collection });
      }
      if (matching.length > collections.length) {
        result.push({ kind: "moreCollections", count: matching.length });
      }
    }
    if (showRecipes || waiting) {
      result.push({ kind: "recipesHeading" });
      if (recipeData.recipes.length > 0) {
        for (const recipe of recipeData.recipes) {
          result.push({ kind: "recipe", recipe });
        }
      } else if (waiting || recipeData.isPending) {
        result.push({ kind: "loading" });
      } else if (recipeData.error) {
        result.push({
          kind: "message",
          title: "Couldn't search your recipes",
          body: "Check your connection and try again.",
        });
      } else {
        result.push({
          kind: "message",
          title: "No recipes match",
          body: isNarrowed
            ? "Try taking off a filter."
            : "Try another word or ingredient.",
        });
      }
    }
    if (result.length === 0) {
      // One letter: too short to search, and no tag starts with it.
      result.push({
        kind: "message",
        title: "Keep typing",
        body: "Search starts after two letters.",
      });
    }
    return result;
  }, [
    typing,
    isNarrowed,
    recents,
    tagMatches,
    showCollections,
    collectionData.collections,
    allCollections,
    showRecipes,
    waiting,
    recipeData.recipes,
    recipeData.isPending,
    recipeData.error,
  ]);

  // Keeps the last rows clear of the chips and field, and of the keyboard,
  // which Android doesn't make room for by itself.
  const spacerStyle = useAnimatedStyle(() => ({
    height:
      stackHeight +
      interpolate(keyboardProgress.get(), [0, 1], [restingGap, keyboardGap]) -
      keyboardHeight.get(),
  }));

  // ─── Actions ──────────────────────────────────────────────────────────────
  const pickTag = useCallback(
    (tag: { id: number; name: string }) => {
      addRecentRecipeSearch({ type: "tag", id: tag.id, name: tag.name });
      onFiltersChange(addTag(tag.id));
      onQueryChange("");
    },
    [onFiltersChange, onQueryChange],
  );

  const openRecipe = useCallback(
    (recipe: Recipe) => {
      // The search that found it is worth keeping too, not just the recipe.
      if (hasQuery) addRecentRecipeSearch({ type: "query", text: trimmed });
      addRecentRecipeSearch({
        type: "recipe",
        id: recipe.id,
        name: recipe.name,
        totalTime: recipe.totalTime ?? null,
        coverImage: recipe.coverImage ?? null,
      });
      navigation.navigate("RecipeDetail", { recipeId: recipe.id });
    },
    [hasQuery, trimmed, navigation],
  );

  const openCollection = useCallback(
    (collection: { id: number; name: string; recipeCount: number }) => {
      addRecentRecipeSearch({
        type: "collection",
        id: collection.id,
        name: collection.name,
        recipeCount: collection.recipeCount,
      });
      navigation.navigate("CollectionDetail", { collectionId: collection.id });
    },
    [navigation],
  );

  const handleRecentPress = useCallback(
    (item: RecentRecipeSearch) => {
      switch (item.type) {
        case "query":
          onQueryChange(item.text);
          addRecentRecipeSearch(item);
          break;
        case "tag":
          pickTag(item);
          break;
        case "recipe":
          addRecentRecipeSearch(item);
          navigation.navigate("RecipeDetail", { recipeId: item.id });
          break;
        case "collection":
          openCollection(item);
          break;
      }
    },
    [onQueryChange, pickTag, navigation, openCollection],
  );

  const recipesById = useMemo(
    () => new Map(recipeData.recipes.map((recipe) => [recipe.id, recipe])),
    [recipeData.recipes],
  );
  const handleRecipePress = useCallback(
    (recipeId: number) => {
      const recipe = recipesById.get(recipeId);
      if (recipe) openRecipe(recipe);
    },
    [recipesById, openRecipe],
  );

  const sorts = sortOptions(hasQuery);
  const sortLabel =
    sorts.find((option) => option.value === filters.sort)?.label ?? "";

  // ─── Rendering ────────────────────────────────────────────────────────────
  const renderRow = ({ item }: { item: Row }) => {
    switch (item.kind) {
      case "heading":
        return (
          <View style={styles.heading}>
            <Text type="footnote" style={styles.headingText}>
              {item.title}
            </Text>
            {item.clearable && (
              <Pressable
                onPress={clearRecentRecipeSearches}
                accessibilityRole="button"
                accessibilityLabel="Clear recent searches"
                hitSlop={8}
              >
                <Text type="footnote" style={styles.clear}>
                  Clear
                </Text>
              </Pressable>
            )}
          </View>
        );
      case "recent":
        return (
          <RecentSearchRow
            item={item.item}
            onPress={handleRecentPress}
            onRemove={removeRecentRecipeSearch}
          />
        );
      case "tag":
        return (
          <Pressable
            onPress={() => pickTag(item.tag)}
            accessibilityRole="button"
            accessibilityLabel={`Filter by tag ${item.tag.name}`}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <SearchRowTile icon="pricetag-outline" tinted />
            <View style={styles.rowText}>
              <Text type="headline">{item.tag.name}</Text>
              <Text type="footnote" style={styles.secondary}>
                Tag · {item.tag.recipeCount}{" "}
                {item.tag.recipeCount === 1 ? "recipe" : "recipes"}
              </Text>
            </View>
            <Ionicons name="add" size={22} style={styles.secondary} />
          </Pressable>
        );
      case "collection": {
        const { collection } = item;
        const recipeCount =
          "recipeCount" in collection ? collection.recipeCount : 0;
        const images =
          "previewImages" in collection ? collection.previewImages : [];
        return (
          <Pressable
            onPress={() =>
              openCollection({
                id: collection.id,
                name: collection.name,
                recipeCount,
              })
            }
            accessibilityRole="button"
            accessibilityLabel={`${collection.name}, collection, ${recipeCount} recipes`}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <ImageGrid images={images} width={TILE} />
            <View style={styles.rowText}>
              <Text type="headline" numberOfLines={1}>
                {collection.name}
              </Text>
              <Text type="footnote" style={styles.secondary}>
                Collection · {recipeCount}{" "}
                {recipeCount === 1 ? "recipe" : "recipes"}
              </Text>
            </View>
          </Pressable>
        );
      }
      case "moreCollections":
        return (
          <Pressable
            onPress={() => setAllCollectionsFor(trimmed)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.more, pressed && styles.pressed]}
          >
            <Text type="footnote" style={styles.clear}>
              Show all {item.count} collections
            </Text>
          </Pressable>
        );
      case "recipesHeading":
        return (
          <View style={styles.heading}>
            <Text type="footnote" style={styles.headingText}>
              Recipes
            </Text>
            <RecipeSortMenu
              sort={filters.sort}
              options={sorts}
              onChange={(sort) => onFiltersChange((f) => ({ ...f, sort }))}
            >
              <View style={styles.sort}>
                <Text type="footnote" style={styles.sortText}>
                  {sortLabel}
                </Text>
                <Ionicons
                  name="chevron-down"
                  size={13}
                  style={styles.secondary}
                />
              </View>
            </RecipeSortMenu>
          </View>
        );
      case "recipe":
        return (
          <View style={styles.recipeRow}>
            <RecipeCard
              recipe={item.recipe}
              onPressRecipeId={handleRecipePress}
              compact
            />
          </View>
        );
      case "message":
        return (
          <View style={styles.message}>
            <Text type="headline" style={styles.center}>
              {item.title}
            </Text>
            <Text type="subheadline" style={[styles.center, styles.secondary]}>
              {item.body}
            </Text>
          </View>
        );
      case "loading":
        return (
          <ActivityIndicator
            style={styles.loading}
            color={theme.colors.primary}
          />
        );
    }
  };

  return (
    <FlashList<Row>
      data={rows}
      renderItem={renderRow}
      keyExtractor={rowKey}
      getItemType={(row) => row.kind}
      extraData={sortLabel}
      onEndReached={showRecipes ? recipeData.handleLoadMore : undefined}
      onEndReachedThreshold={0.5}
      ListFooterComponent={
        <>
          {recipeData.isFetchingNext && (
            <ActivityIndicator
              style={styles.loading}
              color={theme.colors.primary}
            />
          )}
          <Animated.View style={spacerStyle} />
        </>
      }
      contentContainerStyle={{ paddingTop: rt.insets.top + 8 }}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
    />
  );
};

const styles = StyleSheet.create((theme) => ({
  heading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: H_PAD,
    paddingTop: 18,
    paddingBottom: 6,
  },
  headingText: {
    fontFamily: theme.fonts.bold,
    color: theme.colors.textSecondary,
  },
  clear: {
    fontFamily: theme.fonts.bold,
    color: theme.colors.primary,
  },
  more: {
    paddingHorizontal: H_PAD,
    paddingVertical: 10,
  },
  sort: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 32,
  },
  sortText: {
    fontFamily: theme.fonts.bold,
    color: theme.colors.text,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: H_PAD,
    paddingVertical: 8,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  pressed: {
    backgroundColor: theme.colors.pressHighlight,
  },
  secondary: {
    color: theme.colors.textSecondary,
  },
  // RecipeCard brings its own side padding.
  recipeRow: {
    paddingVertical: 8,
  },
  message: {
    paddingHorizontal: 40,
    paddingTop: 48,
    gap: 6,
  },
  center: {
    textAlign: "center",
  },
  loading: {
    marginTop: 32,
  },
}));
