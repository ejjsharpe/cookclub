import { TrueSheet } from "@lodev09/react-native-true-sheet";
import { LinearGradient } from "expo-linear-gradient";
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  TextInput,
  View,
} from "react-native";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, {
  FadeIn,
  FadeInLeft,
  FadeInRight,
  FadeOut,
  FadeOutLeft,
  FadeOutRight,
  interpolate,
  useAnimatedStyle,
} from "react-native-reanimated";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { AppSheet } from "./AppSheet";
import { CollectionGridCard } from "./CollectionGridCard";
import { FilterSheet, type FilterSheetRef } from "./FilterBottomSheet";
import { RecipeCard } from "./RecipeCard";
import { MyRecipesListSkeleton, Skeleton } from "./Skeleton";
import { Text } from "./Text";
import {
  useGetCollectionDetail,
  type CollectionRecipe,
} from "../api/collection";

import { SystemIcon } from "@/components/SystemIcon";
import { GlassSurface } from "@/components/glass/Glass";
import { GlassCircleButton } from "@/components/glass/GlassCircleButton";
import {
  useRecipeCollectionBrowser,
  type CollectionWithMetadata,
  type Recipe,
} from "@/hooks/useRecipeCollectionBrowser";

// The same sizes as the Recipes tab, so the two read as one library.
const COLLECTION_CARD_WIDTH = 132;
const RECIPE_ROW_GAP = 16;
const HEADER_BUTTON = 40;
/** Gap between the search bar and the keyboard while typing. */
const KEYBOARD_GAP = 10;
/** Moving into or out of a collection, like a push in a navigation stack. */
const PUSH_MS = 260;
const FORWARD = {
  entering: FadeInRight.duration(PUSH_MS),
  exiting: FadeOutLeft.duration(PUSH_MS),
};
const BACK = {
  entering: FadeInLeft.duration(PUSH_MS),
  exiting: FadeOutRight.duration(PUSH_MS),
};
const FIELD = 50;

type PickerRecipe = Recipe | CollectionRecipe;

const NO_EXCLUDED_IDS: number[] = [];

const RecipeSeparator = () => <View style={styles.recipeGap} />;
const CollectionSeparator = () => <View style={styles.collectionGap} />;

export interface RecipeBrowserSheetProps {
  /** Title displayed in the sheet header */
  title: string;
  /** Shown under the title, e.g. the meal time menu */
  subtitle?: ReactNode;
  /** Called when a recipe is selected. Return a promise to dismiss after completion. */
  onSelectRecipe: (recipeId: number) => Promise<void> | void;
  /** Called when the sheet is dismissed */
  onDismiss?: () => void;
  /** Recipe IDs that should not be selectable in this browser */
  excludedRecipeIds?: number[];
  /** Empty-state text when every loaded recipe is excluded */
  excludedRecipesEmptyMessage?: string;
  /** What tapping a recipe does, for screen readers */
  rowAccessibilityHint?: string;
  /** Show a + on each row. Off when picking opens something else. */
  showAddButton?: boolean;
}

export interface RecipeBrowserSheetRef {
  present: () => void;
  dismiss: () => void;
}

/**
 * Pick one of your recipes to add somewhere: collections as on the Recipes
 * tab, then your recipes newest first, with search at the bottom.
 */
export const RecipeBrowserSheet = forwardRef<
  RecipeBrowserSheetRef,
  RecipeBrowserSheetProps
>(
  (
    {
      title,
      subtitle,
      onSelectRecipe,
      onDismiss,
      excludedRecipeIds = NO_EXCLUDED_IDS,
      excludedRecipesEmptyMessage = "All recipes are already selected",
      rowAccessibilityHint = "Adds this recipe",
      showAddButton = true,
    },
    ref,
  ) => {
    const { theme, rt } = useUnistyles();
    const sheetRef = useRef<TrueSheet>(null);
    const filterSheetRef = useRef<FilterSheetRef>(null);
    const { progress: keyboardProgress } = useReanimatedKeyboardAnimation();
    const [selectedCollectionId, setSelectedCollectionId] = useState<
      number | null
    >(null);
    const [pendingRecipeId, setPendingRecipeId] = useState<number | null>(null);
    // State updates too late to stop a second quick tap, so guard with a ref.
    const isSelectingRef = useRef(false);
    const [isPresented, setIsPresented] = useState(false);
    const [collectionQuery, setCollectionQuery] = useState("");
    // Which way the list slides when moving into or out of a collection.
    const [isGoingBack, setIsGoingBack] = useState(false);

    const {
      searchQuery,
      setSearchQuery,
      hasActiveFilters,
      filterSheetProps,
      recipes,
      isPendingRecipes,
      recipesError,
      isFetchingNextRecipes,
      hasMoreRecipes,
      handleLoadMoreRecipes,
      collections,
      isPendingCollections,
      clearFilters,
    } = useRecipeCollectionBrowser();

    const inCollection = selectedCollectionId !== null;
    const {
      data: collectionDetail,
      isPending: isPendingCollection,
      isError: isCollectionError,
    } = useGetCollectionDetail({
      collectionId: selectedCollectionId ?? 0,
      enabled: inCollection,
    });
    // From the tile, so the title is right before the detail has loaded.
    const selectedCollectionName = inCollection
      ? (collections.find((c) => c.id === selectedCollectionId)?.name ??
        collectionDetail?.name)
      : undefined;

    const excludedRecipeIdSet = useMemo(
      () => new Set(excludedRecipeIds),
      [excludedRecipeIds],
    );

    const visibleRecipes = useMemo(
      () => recipes.filter((recipe) => !excludedRecipeIdSet.has(recipe.id)),
      [recipes, excludedRecipeIdSet],
    );

    const visibleCollectionRecipes = useMemo(() => {
      const term = collectionQuery.trim().toLowerCase();
      return (collectionDetail?.recipes ?? []).filter(
        (recipe) =>
          !excludedRecipeIdSet.has(recipe.id) &&
          (!term || recipe.name.toLowerCase().includes(term)),
      );
    }, [collectionDetail?.recipes, collectionQuery, excludedRecipeIdSet]);

    // Every loaded recipe may be excluded; keep paging until some show.
    useEffect(() => {
      if (
        isPendingRecipes ||
        !isPresented ||
        isFetchingNextRecipes ||
        visibleRecipes.length > 0 ||
        recipes.length === 0 ||
        !hasMoreRecipes
      ) {
        return;
      }

      handleLoadMoreRecipes();
    }, [
      handleLoadMoreRecipes,
      hasMoreRecipes,
      isPresented,
      isFetchingNextRecipes,
      isPendingRecipes,
      recipes.length,
      visibleRecipes.length,
    ]);

    useImperativeHandle(ref, () => ({
      present: () => {
        setIsPresented(true);
        sheetRef.current?.present();
      },
      dismiss: () => sheetRef.current?.dismiss(),
    }));

    const handleDismiss = () => {
      setIsPresented(false);
      setSelectedCollectionId(null);
      setSearchQuery("");
      setCollectionQuery("");
      clearFilters();
      onDismiss?.();
    };

    const handleSelectRecipe = useCallback(
      async (recipeId: number) => {
        if (isSelectingRef.current) return;
        isSelectingRef.current = true;

        try {
          setPendingRecipeId(recipeId);
          await onSelectRecipe(recipeId);
          sheetRef.current?.dismiss();
        } catch {
          // Error handled by caller
        } finally {
          isSelectingRef.current = false;
          setPendingRecipeId(null);
        }
      },
      [onSelectRecipe],
    );

    const handleOpenCollection = useCallback((collectionId: number) => {
      setIsGoingBack(false);
      setCollectionQuery("");
      setSelectedCollectionId(collectionId);
    }, []);

    const handleBack = useCallback(() => {
      setIsGoingBack(true);
      setSelectedCollectionId(null);
      setCollectionQuery("");
    }, []);

    const renderRecipe = useCallback(
      ({ item }: { item: PickerRecipe }) => (
        <PickerRow
          recipe={item}
          onSelect={handleSelectRecipe}
          isPending={pendingRecipeId === item.id}
          disabled={pendingRecipeId !== null}
          hint={rowAccessibilityHint}
          showAddButton={showAddButton}
        />
      ),
      [
        handleSelectRecipe,
        pendingRecipeId,
        rowAccessibilityHint,
        showAddButton,
      ],
    );

    const renderCollection = useCallback(
      ({ item }: { item: CollectionWithMetadata }) => (
        <CollectionGridCard
          collection={item}
          onPressCollection={handleOpenCollection}
          width={COLLECTION_CARD_WIDTH}
        />
      ),
      [handleOpenCollection],
    );

    const query = inCollection ? collectionQuery : searchQuery;
    const setQuery = inCollection ? setCollectionQuery : setSearchQuery;

    const listHeader = inCollection ? undefined : (
      <View>
        {isPendingCollections ? (
          // Holds the shelf's place so the list doesn't jump when it loads.
          <View style={styles.section}>
            <Text type="title3" style={styles.sectionTitle}>
              Collections
            </Text>
            <View style={[styles.horizontalList, styles.shelfPlaceholder]}>
              {[0, 1, 2].map((i) => (
                <Skeleton
                  key={i}
                  width={COLLECTION_CARD_WIDTH}
                  height={COLLECTION_CARD_WIDTH}
                  borderRadius={16}
                />
              ))}
            </View>
          </View>
        ) : collections.length > 0 ? (
          <View style={styles.section}>
            <Text type="title3" style={styles.sectionTitle}>
              Collections
            </Text>
            <FlatList
              horizontal
              data={collections}
              renderItem={renderCollection}
              keyExtractor={(item) => item.id.toString()}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
              ItemSeparatorComponent={CollectionSeparator}
              keyboardShouldPersistTaps="handled"
            />
          </View>
        ) : null}
        {visibleRecipes.length > 0 ? (
          <Text type="title3" style={[styles.sectionTitle, styles.section]}>
            {searchQuery.trim() ? "Recipes" : "Recently added"}
          </Text>
        ) : null}
      </View>
    );

    const emptyState = (() => {
      if (inCollection ? isPendingCollection : isPendingRecipes) {
        return (
          <View style={styles.skeleton}>
            <MyRecipesListSkeleton />
          </View>
        );
      }
      if (!inCollection && recipesError) {
        return <EmptyState text="Couldn't load your recipes" />;
      }
      if (inCollection && isCollectionError) {
        return <EmptyState text="Couldn't load this collection" />;
      }
      if (inCollection) {
        const total = collectionDetail?.recipes.length ?? 0;
        return (
          <EmptyState
            text={
              collectionQuery.trim()
                ? `No recipes match "${collectionQuery.trim()}"`
                : total > 0
                  ? excludedRecipesEmptyMessage
                  : "No recipes in this collection yet"
            }
          />
        );
      }
      if (isFetchingNextRecipes) return <EmptyState text="Loading more…" />;
      return (
        <EmptyState
          text={
            recipes.length > 0
              ? excludedRecipesEmptyMessage
              : searchQuery.trim()
                ? `No recipes match "${searchQuery.trim()}"`
                : "You don't have any recipes yet"
          }
        />
      );
    })();

    const header = (
      <View style={styles.header}>
        <View style={styles.headerSide}>
          {inCollection ? (
            <GlassCircleButton
              size={HEADER_BUTTON}
              icon={{ sf: "chevron.left", android: "chevron-back" }}
              accessibilityLabel="Back to all recipes"
              onPress={handleBack}
            />
          ) : null}
        </View>
        <View style={styles.headerCenter}>
          <Animated.View
            key={inCollection ? "collection" : "all"}
            entering={FadeIn.duration(PUSH_MS)}
            exiting={FadeOut.duration(PUSH_MS / 2)}
            style={styles.headerTitleWrap}
          >
            <Text
              type="headline"
              numberOfLines={1}
              accessibilityRole="header"
              style={styles.headerTitle}
            >
              {inCollection ? (selectedCollectionName ?? "Collection") : title}
            </Text>
          </Animated.View>
          {subtitle}
        </View>
        <View style={styles.headerSide}>
          <GlassCircleButton
            size={HEADER_BUTTON}
            icon={{ sf: "xmark", android: "close" }}
            accessibilityLabel="Close"
            onPress={() => sheetRef.current?.dismiss()}
          />
        </View>
      </View>
    );

    const searchPlaceholder = inCollection
      ? `Search ${selectedCollectionName ?? "this collection"}`
      : "Search your recipes";

    // In the sheet's footer, which sits at the bottom of the screen and
    // above the keyboard; the fade hides the rows scrolling under it.
    // The home indicator gap isn't needed over the keyboard, so the bar
    // drops into it as the keyboard opens.
    const restingGap = rt.insets.bottom;
    const footerStyle = useAnimatedStyle(() => ({
      transform: [
        {
          translateY: interpolate(
            keyboardProgress.get(),
            [0, 1],
            [0, restingGap - KEYBOARD_GAP],
          ),
        },
      ],
    }));

    const footer = (
      <Animated.View
        style={[styles.footer, { paddingBottom: restingGap }, footerStyle]}
      >
        {/* Behind the controls, so the glass sits on top of the fade. */}
        <LinearGradient
          pointerEvents="none"
          colors={[`${theme.colors.background}00`, theme.colors.background]}
          locations={[0, 0.6]}
          style={styles.footerFade}
        />
        <View style={styles.controls}>
          <View style={styles.fieldWrap}>
            <GlassSurface
              interactive
              style={styles.field}
              contentStyle={styles.fieldContent}
            >
              <SystemIcon
                sf="magnifyingglass"
                android="search"
                size={18}
                color={theme.colors.textSecondary}
              />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={searchPlaceholder}
                placeholderTextColor={theme.colors.textSecondary}
                accessibilityLabel={searchPlaceholder}
                returnKeyType="search"
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
              />
              {query.length > 0 ? (
                <Pressable
                  onPress={() => setQuery("")}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  hitSlop={10}
                >
                  <SystemIcon
                    sf="xmark.circle.fill"
                    android="close-circle"
                    size={18}
                    color={theme.colors.textTertiary}
                  />
                </Pressable>
              ) : null}
            </GlassSurface>
          </View>
          {inCollection ? null : (
            <View>
              <GlassCircleButton
                size={FIELD}
                icon={{
                  sf: "line.3.horizontal.decrease",
                  android: "options-outline",
                }}
                accessibilityLabel={
                  hasActiveFilters ? "Filters, some applied" : "Filters"
                }
                onPress={() => filterSheetRef.current?.present()}
              />
              {hasActiveFilters ? (
                <View pointerEvents="none" style={styles.filterBadge} />
              ) : null}
            </View>
          )}
        </View>
      </Animated.View>
    );

    return (
      <AppSheet
        ref={sheetRef}
        title={title}
        headerContent={header}
        footer={footer}
        detents={[1]}
        backgroundColor={theme.colors.background}
        scrollable
        onDidDismiss={handleDismiss}
      >
        <Animated.FlatList<PickerRecipe>
          key={inCollection ? `collection-${selectedCollectionId}` : "all"}
          {...(isGoingBack ? BACK : FORWARD)}
          data={inCollection ? visibleCollectionRecipes : visibleRecipes}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderRecipe}
          ItemSeparatorComponent={RecipeSeparator}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={emptyState}
          ListFooterComponent={
            // The empty state says "Loading more…" when nothing shows yet.
            !inCollection &&
            isFetchingNextRecipes &&
            visibleRecipes.length > 0 ? (
              <View style={styles.loadingMore}>
                <ActivityIndicator />
              </View>
            ) : undefined
          }
          onEndReached={inCollection ? undefined : handleLoadMoreRecipes}
          onEndReachedThreshold={0.5}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.listContent,
            // TrueSheet already insets the list by the home indicator.
            { paddingBottom: FIELD + 40 },
          ]}
        />

        <FilterSheet ref={filterSheetRef} {...filterSheetProps} />
      </AppSheet>
    );
  },
);

/** A row with its + kept stable, so rows don't redraw on every keystroke. */
const PickerRow = memo(function PickerRow({
  recipe,
  onSelect,
  isPending,
  disabled,
  hint,
  showAddButton,
}: {
  recipe: PickerRecipe;
  onSelect: (recipeId: number) => void;
  isPending: boolean;
  disabled: boolean;
  hint: string;
  showAddButton: boolean;
}) {
  const { theme } = useUnistyles();
  return (
    <RecipeCard
      recipe={recipe}
      onPressRecipeId={onSelect}
      compact
      disabled={disabled}
      accessibilityHint={hint}
      trailing={
        showAddButton ? (
          <View style={styles.addButton}>
            {isPending ? (
              <ActivityIndicator size="small" />
            ) : (
              <SystemIcon
                sf="plus"
                android="add"
                size={16}
                color={theme.colors.text}
              />
            )}
          </View>
        ) : isPending ? (
          <ActivityIndicator size="small" />
        ) : undefined
      }
    />
  );
});

const EmptyState = ({ text }: { text: string }) => (
  <View style={styles.empty}>
    <Text type="subheadline" style={styles.emptyText}>
      {text}
    </Text>
  </View>
);

const styles = StyleSheet.create((theme) => ({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 6,
    gap: 8,
  },
  headerSide: {
    width: HEADER_BUTTON,
    height: HEADER_BUTTON,
  },
  headerCenter: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
  },
  headerTitleWrap: {
    maxWidth: "100%",
  },
  headerTitle: {
    textAlign: "center",
  },
  listContent: {
    flexGrow: 1,
  },
  section: {
    marginTop: 12,
  },
  sectionTitle: {
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  horizontalList: {
    paddingHorizontal: 20,
  },
  shelfPlaceholder: {
    flexDirection: "row",
    gap: 12,
    // The tiles' name and count lines.
    paddingBottom: 44,
  },
  collectionGap: {
    width: 12,
  },
  recipeGap: {
    height: RECIPE_ROW_GAP,
  },
  addButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.inputBackground,
    alignItems: "center",
    justifyContent: "center",
  },
  skeleton: {
    paddingTop: 12,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    paddingVertical: 60,
  },
  emptyText: {
    textAlign: "center",
    color: theme.colors.textSecondary,
  },
  loadingMore: {
    paddingVertical: 20,
    alignItems: "center",
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    zIndex: 1,
  },
  footerFade: {
    position: "absolute",
    left: 0,
    right: 0,
    top: -24,
    bottom: 0,
  },
  fieldWrap: {
    flex: 1,
  },
  field: {
    height: FIELD,
    borderRadius: FIELD / 2,
  },
  fieldContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 16,
    paddingRight: 14,
    gap: 8,
  },
  input: {
    flex: 1,
    height: FIELD,
    fontFamily: theme.fonts.medium,
    fontSize: 16,
    color: theme.colors.text,
  },
  filterBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.primary,
  },
}));
