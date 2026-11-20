import {
  useRoute,
  useNavigation,
  type RouteProp,
} from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  View,
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Pressable,
  RefreshControl,
  TextInput,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, {
  interpolate,
  useAnimatedStyle,
} from "react-native-reanimated";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import {
  useGetCollectionDetail,
  useDeleteCollection,
  useAddRecipeToCollection,
  type CollectionRecipe,
} from "@/api/collection";
import type { RecipeSort } from "@/api/recipe";
import {
  RecipeBrowserSheet,
  type RecipeBrowserSheetRef,
} from "@/components/RecipeBrowserSheet";
import { SystemIcon } from "@/components/SystemIcon";
import { Text } from "@/components/Text";
import { TopScrollFade } from "@/components/TopScrollFade";
import { PrimaryButton } from "@/components/buttons/PrimaryButton";
import { CommentOptionsMenu } from "@/components/comment-options/CommentOptionsMenu";
import type { CommentOption } from "@/components/comment-options/types";
import { GLASS_CONTROL_SIZE, GlassSurface } from "@/components/glass/Glass";
import { GlassCircleButton } from "@/components/glass/GlassCircleButton";
import {
  COVER_HEIGHT,
  CollectionCover,
  CollectionRecipeRow,
} from "@/features/collection/CollectionParts";
import { RecipeSortMenu } from "@/features/recipe-search/RecipeSortMenu";
import type { RootStackParamList } from "@/navigation/navigationRef";

const FIELD = 50;
/** Space between the field and the top of the keyboard. */
const KEYBOARD_GAP = 14;
const BOTTOM_GAP = 8;

const SORT_OPTIONS: { value: RecipeSort; label: string }[] = [
  { value: "default", label: "Recently added" },
  { value: "name", label: "Name" },
  { value: "time", label: "Quickest first" },
];

type CollectionDetailScreenRoute = RouteProp<
  RootStackParamList,
  "CollectionDetail"
>;

const sortRecipes = (recipes: CollectionRecipe[], sort: RecipeSort) => {
  if (sort === "name") {
    return [...recipes].sort((a, b) => a.name.localeCompare(b.name));
  }
  if (sort === "time") {
    // Same as the Recipes tab: total time, recipes without one last, ties by
    // name.
    return [...recipes].sort((a, b) => {
      if (a.totalTime !== b.totalTime) {
        if (a.totalTime === null) return 1;
        if (b.totalTime === null) return -1;
        return a.totalTime - b.totalTime;
      }
      return a.name.localeCompare(b.name);
    });
  }
  // The server sends them newest first.
  return recipes;
};

export const CollectionDetailScreen = () => {
  const route = useRoute<CollectionDetailScreenRoute>();
  const navigation = useNavigation();
  const { theme, rt } = useUnistyles();
  const { collectionId } = route.params;
  const recipeBrowserSheetRef = useRef<RecipeBrowserSheetRef>(null);

  const {
    data: collection,
    isPending,
    refetch,
  } = useGetCollectionDetail({ collectionId });
  const deleteCollectionMutation = useDeleteCollection();
  const addRecipeToCollectionMutation = useAddRecipeToCollection();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isTitleCollapsed, setIsTitleCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<RecipeSort>("default");

  const { height: keyboardHeight, progress: keyboardProgress } =
    useReanimatedKeyboardAnimation();

  const recipes = collection?.recipes;
  const excludedRecipeIds = useMemo(
    () => recipes?.map((recipe) => recipe.id) ?? [],
    [recipes],
  );
  const coverImage = useMemo(
    () => recipes?.find((recipe) => recipe.coverImage)?.coverImage ?? null,
    [recipes],
  );
  const visibleRecipes = useMemo(() => {
    const term = query.trim().toLowerCase();
    const matching = term
      ? (recipes ?? []).filter((recipe) =>
          recipe.name.toLowerCase().includes(term),
        )
      : (recipes ?? []);
    return sortRecipes(matching, sort);
  }, [recipes, query, sort]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  };

  const handleOpenAddRecipe = useCallback(() => {
    // Otherwise the keyboard stays over the sheet, or comes back after it.
    Keyboard.dismiss();
    recipeBrowserSheetRef.current?.present();
  }, []);

  const handleSelectRecipe = useCallback(
    async (recipeId: number) => {
      await addRecipeToCollectionMutation.mutateAsync({
        recipeId,
        collectionId,
      });
    },
    [addRecipeToCollectionMutation, collectionId],
  );

  const handleOpenRecipe = useCallback(
    (recipeId: number) => navigation.navigate("RecipeDetail", { recipeId }),
    [navigation],
  );

  const handleDeleteCollection = () => {
    if (!collection) return;
    Alert.alert(
      "Delete collection",
      `"${collection.name}" will be deleted. Recipes you added yourself that aren't in another collection move to Want to cook.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            // Leave first, so this screen isn't watching the collection while
            // it's removed from the cache and doesn't ask for it again.
            navigation.goBack();
            deleteCollectionMutation.mutate({ collectionId: collection.id });
          },
        },
      ],
    );
  };

  // The name moves into the toolbar once the cover has scrolled away.
  const collapseAt = coverImage ? COVER_HEIGHT - 20 : 44;
  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const collapsed = event.nativeEvent.contentOffset.y > collapseAt;
    if (collapsed !== isTitleCollapsed) setIsTitleCollapsed(collapsed);
  };

  const restingBottom = rt.insets.bottom + BOTTOM_GAP;
  const bottomBarStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY:
          keyboardHeight.get() +
          interpolate(
            keyboardProgress.get(),
            [0, 1],
            [0, restingBottom - KEYBOARD_GAP],
          ),
      },
    ],
  }));

  const keyboardSpacerStyle = useAnimatedStyle(() => ({
    height: Math.max(0, -keyboardHeight.get() - restingBottom),
  }));

  const backButton = (
    <GlassCircleButton
      icon={{ sf: "chevron.backward", android: "chevron-back" }}
      accessibilityLabel="Go back"
      onPress={navigation.goBack}
    />
  );

  // Keep what's loaded if a refresh fails; only an empty screen shows the error.
  if (!collection) {
    return (
      <View style={styles.screen}>
        <View style={styles.centered}>
          {isPending ? (
            <ActivityIndicator size="large" />
          ) : (
            <Text type="bodyFaded">Couldn't load this collection</Text>
          )}
        </View>
        <View style={styles.toolbar} pointerEvents="box-none">
          {backButton}
        </View>
      </View>
    );
  }

  const isEmpty = collection.recipes.length === 0;
  // Adding has its own button, so the menu is only for collections you made,
  // which can be deleted. Want to cook and Cooked can't.
  const menuOptions: CommentOption[] =
    collection.defaultType === null
      ? [
          {
            key: "delete",
            label: "Delete collection",
            systemImage: "trash",
            destructive: true,
            run: handleDeleteCollection,
          },
        ]
      : [];
  const currentSort = SORT_OPTIONS.find((option) => option.value === sort);

  const header = (
    <View>
      <CollectionCover
        name={collection.name}
        count={collection.recipeCount}
        image={coverImage}
      />
      {collection.recipes.length > 1 ? (
        <View style={styles.sortLine}>
          <Text type="footnote" style={styles.sortLabel}>
            {currentSort?.label}
          </Text>
          <RecipeSortMenu sort={sort} options={SORT_OPTIONS} onChange={setSort}>
            <View style={styles.sortTrigger}>
              <Text type="footnote" style={styles.sortLabel}>
                Sort
              </Text>
              <SystemIcon
                sf="chevron.up.chevron.down"
                android="swap-vertical"
                size={12}
                color={theme.colors.textSecondary}
              />
            </View>
          </RecipeSortMenu>
        </View>
      ) : (
        <View style={styles.headerGap} />
      )}
    </View>
  );

  const empty = isEmpty ? (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <SystemIcon
          sf="fork.knife"
          android="restaurant"
          size={26}
          color={theme.colors.textTertiary}
        />
      </View>
      <Text type="title3" style={styles.emptyTitle}>
        Nothing here yet
      </Text>
      <Text type="subheadline" style={styles.emptyText}>
        Add recipes from your library to fill this collection.
      </Text>
      <PrimaryButton
        onPress={handleOpenAddRecipe}
        disabled={addRecipeToCollectionMutation.isPending}
        style={styles.emptyButton}
      >
        Add recipes
      </PrimaryButton>
    </View>
  ) : (
    <View style={styles.empty}>
      <Text type="subheadline" style={styles.emptyText}>
        No recipes match "{query.trim()}"
      </Text>
    </View>
  );

  return (
    <View style={styles.screen}>
      <FlatList
        data={visibleRecipes}
        keyExtractor={(recipe) => String(recipe.id)}
        renderItem={({ item }) => (
          <CollectionRecipeRow recipe={item} onPress={handleOpenRecipe} />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        // Room for the keyboard, so the last rows can still scroll into view.
        ListFooterComponent={<Animated.View style={keyboardSpacerStyle} />}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: rt.insets.bottom + FIELD + 40 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
            progressViewOffset={rt.insets.top + GLASS_CONTROL_SIZE}
          />
        }
        onScroll={handleScroll}
        scrollEventThrottle={16}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      />

      <TopScrollFade />
      <View style={styles.toolbar} pointerEvents="box-none">
        {backButton}
        {/* Wrapped so a long name shrinks on every glass fallback, which
            don't all put the style on the outer view. */}
        <View style={styles.titleSlot} pointerEvents="none">
          <GlassSurface
            hidden={!isTitleCollapsed}
            style={styles.titlePill}
            contentStyle={styles.titlePillContent}
          >
            {/* The cover already says this to screen readers. */}
            <Text
              type="headline"
              numberOfLines={1}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {collection.name}
            </Text>
          </GlassSurface>
        </View>
        {menuOptions.length > 0 ? (
          <CommentOptionsMenu
            options={menuOptions}
            accessibilityLabel="Collection options"
          >
            <View
              accessible
              accessibilityRole="button"
              accessibilityLabel="Collection options"
            >
              <GlassSurface interactive style={styles.menuButton}>
                <View style={styles.menuIcon}>
                  <SystemIcon
                    sf="ellipsis"
                    android="ellipsis-horizontal"
                    size={20}
                    color={theme.colors.text}
                  />
                </View>
              </GlassSurface>
            </View>
          </CommentOptionsMenu>
        ) : (
          <View style={styles.menuButton} />
        )}
      </View>

      {isEmpty ? null : (
        <Animated.View
          style={[styles.bottomBar, { bottom: restingBottom }, bottomBarStyle]}
          pointerEvents="box-none"
        >
          <LinearGradient
            pointerEvents="none"
            colors={[`${theme.colors.background}00`, theme.colors.background]}
            locations={[0, 0.6]}
            style={[styles.bottomFade, { bottom: -restingBottom }]}
          />
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
              placeholder={`Search ${collection.name}`}
              placeholderTextColor={theme.colors.textSecondary}
              accessibilityLabel={`Search ${collection.name}`}
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
          <GlassCircleButton
            size={FIELD}
            icon={{ sf: "plus", android: "add" }}
            accessibilityLabel="Add recipes"
            onPress={handleOpenAddRecipe}
            disabled={addRecipeToCollectionMutation.isPending}
          />
        </Animated.View>
      )}

      <RecipeBrowserSheet
        ref={recipeBrowserSheetRef}
        title={`Add to ${collection.name}`}
        rowAccessibilityHint={`Adds it to ${collection.name}`}
        onSelectRecipe={handleSelectRecipe}
        excludedRecipeIds={excludedRecipeIds}
        excludedRecipesEmptyMessage="All recipes are already in this collection"
      />
    </View>
  );
};

const styles = StyleSheet.create((theme, rt) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    flexGrow: 1,
    paddingTop: rt.insets.top + GLASS_CONTROL_SIZE + 16,
  },
  toolbar: {
    position: "absolute",
    top: rt.insets.top + 4,
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  titleSlot: {
    flexShrink: 1,
    alignItems: "center",
  },
  titlePill: {
    height: GLASS_CONTROL_SIZE,
    borderRadius: GLASS_CONTROL_SIZE / 2,
  },
  titlePillContent: {
    flex: 1,
    paddingHorizontal: 18,
    justifyContent: "center",
  },
  menuButton: {
    width: GLASS_CONTROL_SIZE,
    height: GLASS_CONTROL_SIZE,
    borderRadius: GLASS_CONTROL_SIZE / 2,
  },
  menuIcon: {
    width: GLASS_CONTROL_SIZE,
    height: GLASS_CONTROL_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  sortLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 6,
  },
  sortTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
  },
  sortLabel: {
    fontFamily: theme.fonts.bold,
    color: theme.colors.textSecondary,
  },
  headerGap: {
    height: 14,
  },
  empty: {
    alignItems: "center",
    paddingHorizontal: 40,
    paddingTop: 80,
    gap: 8,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: theme.colors.inputBackground,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  emptyTitle: {
    textAlign: "center",
  },
  emptyText: {
    textAlign: "center",
    color: theme.colors.textSecondary,
  },
  emptyButton: {
    marginTop: 14,
  },
  bottomBar: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  bottomFade: {
    position: "absolute",
    left: -16,
    right: -16,
    top: -24,
  },
  field: {
    flex: 1,
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
}));
