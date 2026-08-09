import {
  useRoute,
  useNavigation,
  type RouteProp,
} from "@react-navigation/native";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  View,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
  TouchableOpacity,
} from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";

import {
  useGetCollectionDetail,
  useDeleteCollection,
  useAddRecipeToCollection,
} from "@/api/collection";
import { Ionicons } from "@/components/Ionicons";
import { NavigationHeader } from "@/components/NavigationHeader";
import {
  RecipeBrowserSheet,
  type RecipeBrowserSheetRef,
} from "@/components/RecipeBrowserSheet";
import { RecipeCard } from "@/components/RecipeCard";
import { VSpace } from "@/components/Space";
import { Text } from "@/components/Text";
import type { RootStackParamList } from "@/navigation/navigationRef";

const NAVIGATION_HEADER_HEIGHT = 60;
const RECIPE_ROW_LAYOUT = LinearTransition.duration(220);
const RECIPE_ROW_ENTERING = FadeIn.duration(180);
const RECIPE_EMPTY_ENTERING = FadeIn.duration(180);
const RECIPE_EMPTY_EXITING = FadeOut.duration(120);

const ReanimatedScrollView = Animated.createAnimatedComponent(ScrollView);

type CollectionDetailScreenRoute = RouteProp<
  RootStackParamList,
  "CollectionDetail"
>;

export const CollectionDetailScreen = () => {
  const route = useRoute<CollectionDetailScreenRoute>();
  const navigation = useNavigation();
  const theme = UnistylesRuntime.getTheme();
  const insets = UnistylesRuntime.insets;
  const { collectionId } = route.params;
  const recipeBrowserSheetRef = useRef<RecipeBrowserSheetRef>(null);
  const headerOpacity = useSharedValue(1);
  const headerHidden = useSharedValue(false);

  const {
    data: collection,
    isPending,
    error,
    refetch,
  } = useGetCollectionDetail({ collectionId });

  const deleteCollectionMutation = useDeleteCollection();
  const addRecipeToCollectionMutation = useAddRecipeToCollection();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const excludedRecipeIds = useMemo(
    () => collection?.recipes.map((recipe) => recipe.id) ?? [],
    [collection?.recipes],
  );

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  };

  const handleOpenAddRecipe = useCallback(() => {
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

  const handleDeleteCollection = () => {
    if (!collection) return;

    if (collection.defaultType !== null) {
      Alert.alert("Cannot Delete", "Default collections cannot be deleted.");
      return;
    }

    Alert.alert(
      "Delete Collection",
      `Are you sure you want to delete "${collection.name}"? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            deleteCollectionMutation.mutate(
              { collectionId: collection.id },
              {
                onSuccess: () => {
                  // Navigate back to Recipes screen
                  navigation.goBack();
                },
              },
            );
          },
        },
      ],
    );
  };

  const handleScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      const nextHeaderHidden = event.contentOffset.y > 5;
      if (headerHidden.get() !== nextHeaderHidden) {
        headerHidden.set(nextHeaderHidden);
        headerOpacity.set(
          withTiming(nextHeaderHidden ? 0 : 1, {
            duration: 150,
          }),
        );
      }
    },
  });

  const headerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: headerOpacity.get(),
  }));

  if (isPending) {
    return (
      <View style={styles.screen}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" />
        </View>
        <Animated.View style={styles.fixedHeader}>
          <NavigationHeader title="" />
        </Animated.View>
      </View>
    );
  }

  if (error || !collection) {
    return (
      <View style={styles.screen}>
        <View style={styles.centered}>
          <Text type="bodyFaded">Failed to load collection</Text>
        </View>
        <Animated.View style={styles.fixedHeader}>
          <NavigationHeader title="" />
        </Animated.View>
      </View>
    );
  }

  const addButton = (
    <TouchableOpacity
      onPress={handleOpenAddRecipe}
      style={[
        styles.headerButton,
        addRecipeToCollectionMutation.isPending && styles.headerButtonDisabled,
      ]}
      disabled={addRecipeToCollectionMutation.isPending}
      accessibilityRole="button"
      accessibilityLabel="Add recipe to collection"
    >
      <Ionicons name="add" size={28} style={styles.addIcon} />
    </TouchableOpacity>
  );

  const deleteButton =
    collection.defaultType === null ? (
      <TouchableOpacity
        onPress={handleDeleteCollection}
        style={styles.headerButton}
        accessibilityRole="button"
        accessibilityLabel="Delete collection"
      >
        <Ionicons name="trash-outline" size={22} color="#ff3b30" />
      </TouchableOpacity>
    ) : undefined;
  const headerActions = (
    <View style={styles.headerActions}>
      {addButton}
      {deleteButton}
    </View>
  );
  const refreshOffset = insets.top + NAVIGATION_HEADER_HEIGHT;

  return (
    <View style={styles.screen}>
      <ReanimatedScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + NAVIGATION_HEADER_HEIGHT,
            paddingBottom: insets.bottom + 40,
          },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
            progressViewOffset={refreshOffset}
          />
        }
        onScroll={handleScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.recipeCount}>
          <Text type="bodyFaded">
            {collection.recipeCount}{" "}
            {collection.recipeCount === 1 ? "recipe" : "recipes"}
          </Text>
        </View>

        <VSpace size={16} />

        {collection.recipes.length === 0 ? (
          <Animated.View
            entering={RECIPE_EMPTY_ENTERING}
            exiting={RECIPE_EMPTY_EXITING}
            layout={RECIPE_ROW_LAYOUT}
            style={styles.emptyState}
          >
            <Text type="bodyFaded">No recipes in this collection yet</Text>
          </Animated.View>
        ) : (
          <>
            {collection.recipes.map((recipe, index) => (
              <Animated.View
                key={recipe.id}
                entering={RECIPE_ROW_ENTERING}
                layout={RECIPE_ROW_LAYOUT}
              >
                <RecipeCard
                  recipe={
                    {
                      ...recipe,
                      totalTime: recipe.cookTime,
                      isLiked: false,
                      likeCount: 0,
                      isInShoppingList: false,
                      updatedAt: new Date().toISOString(),
                      description: null,
                      prepTime: null,
                      nutrition: null,
                      owner: {
                        id: "current-user",
                        name: "You",
                        username: null,
                        image: null,
                      },
                    } as any
                  }
                  onPress={() =>
                    navigation.navigate("RecipeDetail", { recipeId: recipe.id })
                  }
                />
                {index < collection.recipes.length - 1 && <VSpace size={16} />}
              </Animated.View>
            ))}
          </>
        )}
        <VSpace size={40} />
      </ReanimatedScrollView>
      <Animated.View style={[styles.fixedHeader, headerAnimatedStyle]}>
        <NavigationHeader
          title={collection.name}
          rightElement={headerActions}
        />
      </Animated.View>
      <RecipeBrowserSheet
        ref={recipeBrowserSheetRef}
        title={`Add to ${collection.name}`}
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
  fixedHeader: {
    position: "absolute",
    top: rt.insets.top,
    left: rt.insets.left,
    right: rt.insets.right,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 40,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  recipeCount: {
    paddingHorizontal: 20,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.inputBackground,
    justifyContent: "center",
    alignItems: "center",
  },
  headerButtonDisabled: {
    opacity: 0.5,
  },
  addIcon: {
    color: theme.colors.text,
  },
  emptyState: {
    paddingVertical: 60,
    paddingHorizontal: 20,
    alignItems: "center",
  },
}));
