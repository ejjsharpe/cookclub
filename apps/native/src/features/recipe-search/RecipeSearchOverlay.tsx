import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { MIN_RECIPE_SEARCH_LENGTH } from "@repo/shared";
import { FlashList } from "@shopify/flash-list";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import {
  ActivityIndicator,
  BackHandler,
  Keyboard,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
  type TextInputInstance,
} from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";
import { scheduleOnRN } from "react-native-worklets";

import { AppliedPill } from "./FilterChip";
import { RecentSearchRow, SearchRowTile } from "./RecentSearchRow";
import {
  RecipeFilterSheet,
  type RecipeFilterSheetRef,
} from "./RecipeFilterSheet";
import {
  RECIPE_SEARCH_HEADER_HEIGHT,
  RecipeSearchHeader,
  type RecipeSearchTab,
} from "./RecipeSearchHeader";
import {
  DEFAULT_RECIPE_SEARCH_FILTERS,
  SOURCE_OPTIONS,
  activeFilterCount,
  appliedCount,
  sortOptions,
  timeLabel,
  type RecipeSearchFilters,
} from "./recipeSearchFilters";

import { useUserRecipeTags } from "@/api/recipe";
import { CollectionGridCard, GRID_GAP } from "@/components/CollectionGridCard";
import { Ionicons } from "@/components/Ionicons";
import { RecipeCard } from "@/components/RecipeCard";
import { Text } from "@/components/Text";
import {
  useCollectionData,
  type CollectionWithMetadata,
} from "@/hooks/useCollectionData";
import { useDebounce } from "@/hooks/useDebounce";
import { useRecipeData, type Recipe } from "@/hooks/useRecipeData";
import {
  clearRecentRecipeSearches,
  recentRecipeSearchKey,
  removeRecentRecipeSearch,
  addRecentRecipeSearch,
  useRecentRecipeSearches,
  type RecentRecipeSearch,
} from "@/lib/recentRecipeSearches";

const OPEN_TIMING = { duration: 380, easing: Easing.bezier(0.32, 0.72, 0, 1) };
const CLOSE_TIMING = { duration: 280, easing: Easing.bezier(0.4, 0, 0.2, 1) };
/** Extra wait after closing so the native glass hide (300ms) has finished. */
const GLASS_SETTLE_MS = 120;
const H_PAD = 20;
/** Room under the last row so it clears the floating tab bar. */
const TAB_BAR_CLEARANCE = 96;

type RecentRecipe = Extract<RecentRecipeSearch, { type: "recipe" }>;

type Row =
  | { kind: "recent"; item: RecentRecipeSearch }
  | { kind: "recipe"; recipe: Recipe };

export interface RecipeSearchOverlayRef {
  /** Runs the closing animation, then calls `onClosed`. */
  close: () => void;
}

interface RecipeSearchOverlayProps {
  /** Where the Recipes screen's grey search bar sits, in window points. */
  originY: number;
  /** Called once the closing animation has finished. */
  onClosed: () => void;
  ref?: Ref<RecipeSearchOverlayRef>;
}

/**
 * Library search, laid over the Recipes tab so the tab bar stays put and
 * recipes and collections open with a normal push. The grey search bar
 * lifts into a glass field as it opens.
 */
export const RecipeSearchOverlay = ({
  originY,
  onClosed,
  ref,
}: RecipeSearchOverlayProps) => {
  const navigation = useNavigation();
  const insets = UnistylesRuntime.insets;
  const theme = UnistylesRuntime.getTheme();
  const { width } = useWindowDimensions();

  const inputRef = useRef<TextInputInstance>(null);
  const filterSheetRef = useRef<RecipeFilterSheetRef>(null);
  const progress = useSharedValue(0);
  const tornDown = useSharedValue(0);
  const [open, setOpen] = useState(false);
  const closing = useRef(false);

  const [tab, setTab] = useState<RecipeSearchTab>("recipes");
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 250);
  const [filters, setFilters] = useState<RecipeSearchFilters>(
    DEFAULT_RECIPE_SEARCH_FILTERS,
  );
  const recents = useRecentRecipeSearches();
  const { data: tags = [] } = useUserRecipeTags();

  // ─── Open / close ─────────────────────────────────────────────────────────
  useEffect(() => {
    setOpen(true);
    inputRef.current?.focus();
    progress.set(withTiming(1, OPEN_TIMING));
  }, [progress]);

  // Liquid Glass draws a black frame if it's removed mid-way through its own
  // disappear animation, which outlasts CLOSE_TIMING. Everything left on
  // screen by now matches the Recipes screen, so the wait isn't visible.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishClose = useCallback(() => {
    closeTimer.current = setTimeout(onClosed, GLASS_SETTLE_MS);
  }, [onClosed]);
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    Keyboard.dismiss();
    setOpen(false);
    progress.set(
      withTiming(0, CLOSE_TIMING, (finished) => {
        if (finished) {
          // Hide the glass for a frame before removing it (see tornDown).
          tornDown.set(1);
          scheduleOnRN(finishClose);
        }
      }),
    );
  }, [finishClose, progress, tornDown]);

  useImperativeHandle(ref, () => ({ close }), [close]);

  // Android's back button closes search rather than leaving the tab, but only
  // while the Recipes tab is on screen: a recipe pushed from the results (or
  // another tab) handles back itself.
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          close();
          return true;
        },
      );
      return () => subscription.remove();
    }, [close]),
  );

  // Opaque for most of the way, so the library underneath only shows
  // through at the start of opening and the end of closing.
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 0.5], [0, 1], "clamp"),
  }));
  const contentStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ translateY: (1 - progress.get()) * 24 }],
  }));

  // ─── Data ─────────────────────────────────────────────────────────────────
  const trimmedQuery = debouncedQuery.trim();
  const hasQuery = trimmedQuery.length >= MIN_RECIPE_SEARCH_LENGTH;
  const isNarrowed =
    activeFilterCount(filters) > 0 || filters.sort !== "default";
  const showRecipeResults = tab === "recipes" && (hasQuery || isNarrowed);
  const showCollectionResults = tab === "collections" && trimmedQuery !== "";
  const showRecents =
    query.trim() === "" && !showRecipeResults && !showCollectionResults;

  const recipeData = useRecipeData({
    search: debouncedQuery,
    tagIds: filters.tagIds,
    sort: filters.sort,
    ...(filters.maxTotalTime == null
      ? {}
      : { maxTotalTime: filters.maxTotalTime }),
    ...(filters.source ? { source: filters.source } : {}),
    enabled: showRecipeResults,
  });
  const collectionData = useCollectionData({
    search: debouncedQuery,
    enabled: tab === "collections",
  });

  const tagSuggestions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (tab !== "recipes" || !needle) return [];
    // Match the start of any word, so "c" offers "Chinese" not "American".
    return tags
      .filter(
        (tag) =>
          tag.name
            .toLowerCase()
            .split(/\s+/)
            .some((word) => word.startsWith(needle)) &&
          !filters.tagIds.includes(tag.id),
      )
      .slice(0, 3);
  }, [tab, query, tags, filters.tagIds]);

  const rows = useMemo<Row[]>(() => {
    if (showRecents) {
      return recents.map((item) => ({ kind: "recent", item }));
    }
    if (showRecipeResults) {
      return recipeData.recipes.map((recipe) => ({ kind: "recipe", recipe }));
    }
    return [];
  }, [showRecents, recents, showRecipeResults, recipeData.recipes]);

  const pills = useMemo(() => {
    const result: { key: string; label: string; remove: () => void }[] = [];
    if (filters.sort !== "default") {
      const label = sortOptions(hasQuery).find(
        (option) => option.value === filters.sort,
      )?.label;
      if (label) {
        result.push({
          key: "sort",
          label,
          remove: () => setFilters((f) => ({ ...f, sort: "default" })),
        });
      }
    }
    if (filters.maxTotalTime != null) {
      result.push({
        key: "time",
        label: timeLabel(filters.maxTotalTime),
        remove: () => setFilters((f) => ({ ...f, maxTotalTime: null })),
      });
    }
    if (filters.source) {
      const label = SOURCE_OPTIONS.find(
        (option) => option.value === filters.source,
      )?.label;
      result.push({
        key: "source",
        label: label ?? filters.source,
        remove: () => setFilters((f) => ({ ...f, source: null })),
      });
    }
    for (const tagId of filters.tagIds) {
      const tag = tags.find((item) => item.id === tagId);
      result.push({
        key: `tag:${tagId}`,
        label: tag?.name ?? "Tag",
        remove: () =>
          setFilters((f) => ({
            ...f,
            tagIds: f.tagIds.filter((id) => id !== tagId),
          })),
      });
    }
    return result;
  }, [filters, tags, hasQuery]);

  // ─── Actions ──────────────────────────────────────────────────────────────
  const addTagFilter = useCallback((tag: { id: number; name: string }) => {
    addRecentRecipeSearch({ type: "tag", id: tag.id, name: tag.name });
    setFilters((f) =>
      f.tagIds.includes(tag.id) ? f : { ...f, tagIds: [...f.tagIds, tag.id] },
    );
    setQuery("");
  }, []);

  const openRecipe = useCallback(
    (recipe: {
      id: number;
      name: string;
      totalTime?: number | null;
      coverImage?: RecentRecipe["coverImage"];
    }) => {
      // Typing then tapping a result is the usual flow, so the search that
      // found it is worth keeping too, not just the recipe.
      if (hasQuery) {
        addRecentRecipeSearch({ type: "query", text: trimmedQuery });
      }
      addRecentRecipeSearch({
        type: "recipe",
        id: recipe.id,
        name: recipe.name,
        totalTime: recipe.totalTime ?? null,
        coverImage: recipe.coverImage ?? null,
      });
      navigation.navigate("RecipeDetail", { recipeId: recipe.id });
    },
    [hasQuery, trimmedQuery, navigation],
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
          setQuery(item.text);
          addRecentRecipeSearch(item);
          break;
        case "tag":
          setTab("recipes");
          addTagFilter(item);
          break;
        case "recipe":
          openRecipe(item);
          break;
        case "collection":
          openCollection(item);
          break;
      }
    },
    [addTagFilter, openRecipe, openCollection],
  );

  const handleSubmit = useCallback(() => {
    if (query.trim())
      addRecentRecipeSearch({ type: "query", text: query.trim() });
  }, [query]);

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

  const collectionsById = useMemo(
    () =>
      new Map(
        collectionData.collections.map((collection) => [
          collection.id,
          collection,
        ]),
      ),
    [collectionData.collections],
  );
  const handleCollectionPress = useCallback(
    (collectionId: number) => {
      const collection = collectionsById.get(collectionId);
      if (collection) {
        openCollection({
          id: collection.id,
          name: collection.name,
          recipeCount: "recipeCount" in collection ? collection.recipeCount : 0,
        });
      }
    },
    [collectionsById, openCollection],
  );

  // ─── Rendering ────────────────────────────────────────────────────────────
  const topInset = insets.top + RECIPE_SEARCH_HEADER_HEIGHT;

  const renderRow = useCallback(
    ({ item }: { item: Row }) =>
      item.kind === "recent" ? (
        <RecentSearchRow
          item={item.item}
          onPress={handleRecentPress}
          onRemove={removeRecentRecipeSearch}
        />
      ) : (
        <View style={styles.recipeRow}>
          <RecipeCard
            recipe={item.recipe}
            onPressRecipeId={handleRecipePress}
            compact
          />
        </View>
      ),
    [handleRecentPress, handleRecipePress],
  );

  const listHeader = (
    <View>
      {tab === "recipes" && pills.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pills}
          keyboardShouldPersistTaps="handled"
        >
          {pills.map((pill) => (
            <AppliedPill
              key={pill.key}
              label={pill.label}
              onRemove={pill.remove}
            />
          ))}
        </ScrollView>
      )}

      {tagSuggestions.length > 0 && (
        <View style={styles.block}>
          <Text type="footnote" style={styles.blockLabel}>
            Filter by tag
          </Text>
          {tagSuggestions.map((tag) => (
            <Pressable
              key={tag.id}
              onPress={() => addTagFilter(tag)}
              accessibilityRole="button"
              accessibilityLabel={`Filter by tag ${tag.name}`}
              style={({ pressed }) => [
                styles.tagRow,
                pressed && styles.pressed,
              ]}
            >
              <SearchRowTile icon="pricetag-outline" tinted />
              <View style={styles.flex}>
                <Text type="headline">{tag.name}</Text>
                <Text type="footnote" style={styles.secondary}>
                  {tag.recipeCount}{" "}
                  {tag.recipeCount === 1 ? "recipe" : "recipes"}
                </Text>
              </View>
              <Ionicons name="add" size={22} style={styles.secondary} />
            </Pressable>
          ))}
        </View>
      )}

      {showRecents && recents.length > 0 && (
        <View style={styles.recentHeader}>
          <Text type="title3">Recently searched</Text>
          <Pressable
            onPress={clearRecentRecipeSearches}
            accessibilityRole="button"
            hitSlop={8}
          >
            <Text type="highlight" style={styles.clear}>
              Clear
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );

  const isLoadingRecipes =
    showRecipeResults && recipeData.isPending && rows.length === 0;

  const listEmpty = isLoadingRecipes ? (
    <ActivityIndicator style={styles.loading} color={theme.colors.primary} />
  ) : showRecents ? (
    <EmptyMessage
      title="Search your library"
      body="Find recipes by name, ingredient or tag, then sort and filter them."
    />
  ) : showRecipeResults ? (
    <EmptyMessage
      title="No recipes match"
      body={
        isNarrowed
          ? "Try a longer cooking time, or remove a filter."
          : "Try another word or ingredient."
      }
    />
  ) : null;

  const collectionCardWidth = (width - H_PAD * 2 - GRID_GAP) / 2;

  return (
    <View style={styles.screen}>
      <Animated.View style={[styles.backdrop, backdropStyle]} />

      <Animated.View style={[styles.flex, contentStyle]}>
        {showCollectionResults ? (
          <FlashList<CollectionWithMetadata>
            data={collectionData.collections}
            numColumns={2}
            keyExtractor={(collection) => collection.id.toString()}
            renderItem={({ item, index }) => (
              <View
                style={[
                  styles.gridCell,
                  index % 2 === 0 ? styles.gridLeft : styles.gridRight,
                ]}
              >
                <CollectionGridCard
                  collection={item}
                  onPressCollection={handleCollectionPress}
                  width={collectionCardWidth}
                />
              </View>
            )}
            contentContainerStyle={{
              paddingTop: topInset + 8,
              paddingBottom: insets.bottom + TAB_BAR_CLEARANCE,
            }}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
            ListEmptyComponent={
              collectionData.isPending ? (
                <ActivityIndicator
                  style={styles.loading}
                  color={theme.colors.primary}
                />
              ) : (
                <EmptyMessage
                  title="No collections found"
                  body="Try another name."
                />
              )
            }
          />
        ) : (
          <FlashList<Row>
            data={rows}
            renderItem={renderRow}
            keyExtractor={(row) =>
              row.kind === "recent"
                ? recentRecipeSearchKey(row.item)
                : `recipe:${row.recipe.id}`
            }
            getItemType={(row) => row.kind}
            ListHeaderComponent={listHeader}
            ListEmptyComponent={listEmpty}
            ListFooterComponent={
              recipeData.isFetchingNext ? (
                <ActivityIndicator
                  style={styles.loading}
                  color={theme.colors.primary}
                />
              ) : null
            }
            onEndReached={
              showRecipeResults ? recipeData.handleLoadMore : undefined
            }
            onEndReachedThreshold={0.5}
            contentContainerStyle={{
              paddingTop: topInset,
              paddingBottom: insets.bottom + TAB_BAR_CLEARANCE,
            }}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
          />
        )}
      </Animated.View>

      <RecipeSearchHeader
        progress={progress}
        tornDown={tornDown}
        originY={originY}
        open={open}
        tab={tab}
        onTabChange={setTab}
        query={query}
        onChangeQuery={setQuery}
        onSubmit={handleSubmit}
        onClose={close}
        onOpenFilters={() => {
          Keyboard.dismiss();
          filterSheetRef.current?.present(filters);
        }}
        appliedCount={appliedCount(filters)}
        inputRef={inputRef}
      />

      <RecipeFilterSheet
        ref={filterSheetRef}
        query={debouncedQuery}
        hasQuery={hasQuery}
        onApply={setFilters}
      />
    </View>
  );
};

const EmptyMessage = ({ title, body }: { title: string; body: string }) => (
  <View style={styles.empty}>
    <Text type="headline" style={styles.center}>
      {title}
    </Text>
    <Text type="subheadline" style={[styles.center, styles.secondary]}>
      {body}
    </Text>
  </View>
);

const styles = StyleSheet.create((theme) => ({
  screen: {
    ...StyleSheet.absoluteFill,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: theme.colors.background,
  },
  flex: {
    flex: 1,
  },
  pills: {
    paddingHorizontal: H_PAD,
    paddingBottom: 8,
    gap: 8,
  },
  block: {
    paddingTop: 8,
  },
  blockLabel: {
    paddingHorizontal: H_PAD,
    paddingBottom: 4,
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.semiBold,
  },
  tagRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: H_PAD,
    paddingVertical: 8,
  },
  pressed: {
    backgroundColor: theme.colors.pressHighlight,
  },
  recentHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingHorizontal: H_PAD,
    paddingTop: 12,
    paddingBottom: 8,
  },
  clear: {
    color: theme.colors.primary,
  },
  // Same 16pt gap as Recently Added on the Recipes screen.
  recipeRow: {
    paddingVertical: 8,
  },
  gridCell: {
    paddingBottom: GRID_GAP,
  },
  gridLeft: {
    paddingLeft: H_PAD,
    paddingRight: GRID_GAP / 2,
  },
  gridRight: {
    paddingLeft: GRID_GAP / 2,
    paddingRight: H_PAD,
  },
  loading: {
    marginTop: 32,
  },
  empty: {
    paddingHorizontal: 40,
    paddingTop: 48,
    gap: 6,
  },
  center: {
    textAlign: "center",
  },
  secondary: {
    color: theme.colors.textSecondary,
  },
}));
