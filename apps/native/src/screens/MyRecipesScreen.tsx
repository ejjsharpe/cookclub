import { useIsFocused, useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Alert,
  RefreshControl,
  type ScrollViewInstance,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedScrollHandler,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";

import {
  useCreateCollection,
  useGetUserCollectionsWithMetadata,
} from "@/api/collection";
import { useGetUserRecipes } from "@/api/recipe";
import { CollectionGridCard } from "@/components/CollectionGridCard";
import { CreateCollectionCard } from "@/components/CreateCollectionCard";
import { Ionicons } from "@/components/Ionicons";
import { RecipeCard } from "@/components/RecipeCard";
import { Skeleton, RecipeCardSkeleton, FadeIn } from "@/components/Skeleton";
import { VSpace } from "@/components/Space";
import { Text } from "@/components/Text";
import {
  RecipeSearch,
  SEARCH_FIELD_CLEARANCE,
  TAB_BAR_HEIGHT,
  type RecipeSearchRef,
} from "@/features/recipe-search/RecipeSearch";
import type { CollectionWithMetadata } from "@/hooks/useCollectionData";

// ─── Constants ───────────────────────────────────────────────────────────────
const HORIZONTAL_PADDING = 20;
const HEADER_HEIGHT = 52;
const COLLECTION_CARD_WIDTH = 132;
/** Space between rows in Recently Added. */
const RECIPE_ROW_GAP = 16;
const EMPTY_COLLECTIONS: CollectionWithMetadata[] = [];

type CollectionItem = CollectionWithMetadata | { id: "create"; type: "create" };

// Static separator component - defined outside to avoid recreation
const CollectionSeparator = () => <View style={styles.collectionSeparator} />;

// Horizontal collection skeleton for loading state
const HorizontalCollectionsSkeleton = () => (
  <View style={styles.horizontalList}>
    <View style={styles.horizontalSkeletonRow}>
      {[100, 80, 90].map((titleWidth, index) => (
        <View key={titleWidth} style={styles.horizontalSkeletonRow}>
          {index > 0 && <View style={styles.collectionSeparator} />}
          <View style={styles.collectionSkeletonCard}>
            <Skeleton
              width={COLLECTION_CARD_WIDTH}
              height={COLLECTION_CARD_WIDTH}
              borderRadius={16}
            />
            <VSpace size={8} />
            <Skeleton width={titleWidth} height={17} borderRadius={4} />
            <VSpace size={4} />
            <Skeleton width={65} height={14} borderRadius={4} />
          </View>
        </View>
      ))}
    </View>
  </View>
);

// Recipe list skeleton for loading state
const RecentRecipesSkeleton = () => (
  <View>
    <RecipeCardSkeleton compact />
    <VSpace size={RECIPE_ROW_GAP} />
    <RecipeCardSkeleton compact />
    <VSpace size={RECIPE_ROW_GAP} />
    <RecipeCardSkeleton compact />
  </View>
);

export const MyRecipesScreen = () => {
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const theme = UnistylesRuntime.getTheme();
  const insets = UnistylesRuntime.insets;
  const browseScrollRef = useRef<ScrollViewInstance>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchRef = useRef<RecipeSearchRef>(null);

  // Scroll-based title fade (like HomeScreen)
  const titleOpacity = useSharedValue(1);
  const titleHidden = useSharedValue(false);

  // ─── Data Fetching ─────────────────────────────────────────────────────────────
  const createCollectionMutation = useCreateCollection();

  const {
    data: collectionsData,
    isLoading: isLoadingCollections,
    refetch: refetchCollections,
  } = useGetUserCollectionsWithMetadata({
    search: "",
  });
  const collections = (collectionsData ??
    EMPTY_COLLECTIONS) as CollectionWithMetadata[];

  const collectionsWithCreate = useMemo<CollectionItem[]>(
    () => [{ id: "create", type: "create" }, ...collections],
    [collections],
  );

  // Recent recipes (first 5)
  const {
    data: recentRecipesData,
    isLoading: isLoadingRecipes,
    refetch: refetchRecentRecipes,
  } = useGetUserRecipes({});
  const recentRecipes = useMemo(() => {
    return (recentRecipesData?.pages[0]?.items ?? []).slice(0, 5);
  }, [recentRecipesData]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([refetchCollections(), refetchRecentRecipes()]);
    } finally {
      setIsRefreshing(false);
    }
  }, [refetchCollections, refetchRecentRecipes]);

  // ─── Handlers ─────────────────────────────────────────────────────────────────
  const handleRecipePress = useCallback(
    (recipeId: number) => {
      navigation.navigate("RecipeDetail", { recipeId });
    },
    [navigation],
  );

  const handleCollectionPress = useCallback(
    (collectionId: number) => {
      navigation.navigate("CollectionDetail", { collectionId });
    },
    [navigation],
  );

  const handleCreateCollection = useCallback(() => {
    Alert.prompt(
      "New Collection",
      "Enter a name for your collection",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Create",
          onPress: (collectionName?: string) => {
            const trimmedName = collectionName?.trim();
            if (!trimmedName) {
              Alert.alert("Error", "Collection name cannot be empty");
              return;
            }
            createCollectionMutation.mutate({ name: trimmedName });
          },
        },
      ],
      "plain-text",
    );
  }, [createCollectionMutation]);

  useEffect(() => {
    // @ts-expect-error navigation type
    const unsubscribe = navigation.addListener("tabPress", () => {
      if (!isFocused) return;
      // Tapping the Recipes tab again leaves search, then scrolls to the top.
      if (isSearchOpen) {
        searchRef.current?.close();
      } else {
        browseScrollRef.current?.scrollTo({ y: 0, animated: true });
      }
    });

    return unsubscribe;
  }, [navigation, isFocused, isSearchOpen]);

  const renderCollectionItem = useCallback(
    ({ item }: { item: CollectionItem }) => {
      if ("type" in item && item.type === "create") {
        return (
          <CreateCollectionCard
            variant="grid"
            onPress={handleCreateCollection}
            disabled={createCollectionMutation.isPending}
            width={COLLECTION_CARD_WIDTH}
          />
        );
      }

      return (
        <CollectionGridCard
          collection={item as CollectionWithMetadata}
          onPressCollection={handleCollectionPress}
          width={COLLECTION_CARD_WIDTH}
        />
      );
    },
    [
      handleCreateCollection,
      createCollectionMutation.isPending,
      handleCollectionPress,
    ],
  );

  // ─── Scroll Handler with Title Fade ────────────────────────────────────────────
  const handleScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      "worklet";
      // Fade out title when scrolling up (search bar would collide with header)
      const titleShouldHide = event.contentOffset.y > 5;
      if (titleHidden.get() !== titleShouldHide) {
        titleHidden.set(titleShouldHide);
        titleOpacity.set(
          withTiming(titleShouldHide ? 0 : 1, {
            duration: 150,
          }),
        );
      }
    },
  });

  const titleAnimatedStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      opacity: titleOpacity.get(),
    };
  });

  // ─── Render ───────────────────────────────────────────────────────────────────
  const refreshOffset = insets.top + HEADER_HEIGHT + 8;

  return (
    <View style={styles.screen}>
      <Animated.ScrollView
        ref={browseScrollRef}
        contentContainerStyle={styles.browseContent}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
            progressViewOffset={refreshOffset}
          />
        }
      >
        {/* Collections Section */}
        <View style={styles.section}>
          <Text type="title3" style={styles.sectionTitle}>
            Collections
          </Text>
          {isLoadingCollections ? (
            <HorizontalCollectionsSkeleton />
          ) : (
            <FadeIn>
              <Animated.FlatList
                horizontal
                data={collectionsWithCreate}
                renderItem={renderCollectionItem}
                keyExtractor={(item) => item.id.toString()}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalList}
                ItemSeparatorComponent={CollectionSeparator}
                initialNumToRender={4}
                maxToRenderPerBatch={4}
                windowSize={5}
                removeClippedSubviews
              />
            </FadeIn>
          )}
        </View>

        {/* Recently Added Section */}
        <View style={styles.section}>
          <Text type="title3" style={styles.sectionTitle}>
            Recently Added
          </Text>
          {isLoadingRecipes ? (
            <RecentRecipesSkeleton />
          ) : recentRecipes.length > 0 ? (
            <FadeIn>
              {recentRecipes.map((recipe, index) => (
                <View key={recipe.id}>
                  <RecipeCard
                    recipe={recipe}
                    onPressRecipeId={handleRecipePress}
                    compact
                  />
                  {index < recentRecipes.length - 1 && (
                    <VSpace size={RECIPE_ROW_GAP} />
                  )}
                </View>
              ))}
            </FadeIn>
          ) : (
            <View style={styles.recipesEmptyState}>
              <Ionicons
                name="book-outline"
                size={36}
                style={styles.emptyIcon}
              />
              <Text type="headline" style={styles.emptyTitle}>
                No recipes in your library yet!
              </Text>
              <Text type="body" style={styles.emptySubtitle}>
                Import recipes from the feed or add your own to get started
              </Text>
            </View>
          )}
        </View>
      </Animated.ScrollView>

      {/* Fixed Title Header */}
      <View style={styles.fixedHeader} pointerEvents="none">
        <Animated.View style={titleAnimatedStyle}>
          <Text type="screenTitle">Recipes</Text>
        </Animated.View>
      </View>

      <RecipeSearch ref={searchRef} onOpenChange={setIsSearchOpen} />
    </View>
  );
};

const styles = StyleSheet.create((theme, rt) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  fixedHeader: {
    position: "absolute",
    top: rt.insets.top,
    left: 0,
    right: 0,
    paddingHorizontal: HORIZONTAL_PADDING,
  },
  browseContent: {
    paddingTop: rt.insets.top + HEADER_HEIGHT - 16,
    // Clears the search field floating above the tab bar.
    paddingBottom: TAB_BAR_HEIGHT + SEARCH_FIELD_CLEARANCE + 24,
  },
  section: {
    marginTop: 24,
  },
  sectionTitle: {
    paddingHorizontal: HORIZONTAL_PADDING,
    marginBottom: 10,
  },
  horizontalList: {
    paddingHorizontal: HORIZONTAL_PADDING,
  },
  collectionSeparator: {
    width: 12,
  },
  horizontalSkeletonRow: {
    flexDirection: "row",
  },
  collectionSkeletonCard: {
    width: COLLECTION_CARD_WIDTH,
  },
  recipesEmptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    paddingVertical: 28,
  },
  emptyIcon: {
    color: theme.colors.textTertiary,
    marginBottom: 16,
  },
  emptyTitle: {
    textAlign: "center",
    marginBottom: 8,
  },
  emptySubtitle: {
    textAlign: "center",
    color: theme.colors.textSecondary,
  },
}));
