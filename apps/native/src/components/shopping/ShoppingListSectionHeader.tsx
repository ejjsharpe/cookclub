import { Image } from "expo-image";
import { memo } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Ionicons } from "@/components/Ionicons";
import { Text } from "@/components/Text";
import type { ShoppingListRecipe } from "@/lib/shoppingListGroups";
import { getImageUrl } from "@/utils/imageUrl";

interface ShoppingListSectionHeaderProps {
  title: string;
  recipe?: ShoppingListRecipe | undefined;
  isFirst: boolean;
  onRecipeMore?: (recipe: ShoppingListRecipe) => void;
}

/**
 * A quiet grey heading for an aisle, or a recipe's photo and name when the
 * list is grouped by recipe.
 */
export const ShoppingListSectionHeader = memo(
  ({
    title,
    recipe,
    isFirst,
    onRecipeMore,
  }: ShoppingListSectionHeaderProps) => {
    if (!recipe) {
      return (
        <Text
          type="footnote"
          style={styles.aisle(isFirst)}
          accessibilityRole="header"
        >
          {title}
        </Text>
      );
    }

    const imageUrl = recipe.imageUrl
      ? getImageUrl(recipe.imageUrl, "recipe-thumb")
      : undefined;

    return (
      <View style={styles.recipeRow(isFirst)}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, styles.thumbEmpty]}>
            <Ionicons name="restaurant" size={14} style={styles.thumbIcon} />
          </View>
        )}
        <Text
          type="headline"
          style={styles.recipeName}
          numberOfLines={1}
          accessibilityRole="header"
        >
          {recipe.name}
        </Text>
        {onRecipeMore && (
          <Pressable
            onPress={() => onRecipeMore(recipe)}
            hitSlop={10}
            style={styles.more}
            accessibilityRole="button"
            accessibilityLabel={`Options for ${recipe.name}`}
          >
            <Ionicons
              name="ellipsis-horizontal"
              size={18}
              style={styles.moreIcon}
            />
          </Pressable>
        )}
      </View>
    );
  },
);

ShoppingListSectionHeader.displayName = "ShoppingListSectionHeader";

const styles = StyleSheet.create((theme) => ({
  aisle: (isFirst: boolean) => ({
    paddingHorizontal: 20,
    paddingTop: isFirst ? 12 : 26,
    paddingBottom: 2,
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.bold,
  }),
  recipeRow: (isFirst: boolean) => ({
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: isFirst ? 12 : 26,
    paddingBottom: 4,
  }),
  thumb: {
    width: 28,
    height: 28,
    borderRadius: 8,
  },
  thumbEmpty: {
    backgroundColor: theme.colors.inputBackground,
    alignItems: "center",
    justifyContent: "center",
  },
  thumbIcon: {
    color: theme.colors.textSecondary,
  },
  recipeName: {
    flex: 1,
    fontFamily: theme.fonts.bold,
  },
  more: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  moreIcon: {
    color: theme.colors.textSecondary,
  },
}));
