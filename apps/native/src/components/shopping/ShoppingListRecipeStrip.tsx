import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import { memo } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Ionicons } from "@/components/Ionicons";
import { Text } from "@/components/Text";
import type { ShoppingListRecipe } from "@/lib/shoppingListGroups";
import { getImageUrl } from "@/utils/imageUrl";

const TILE_SIZE = 76;

interface ShoppingListRecipeStripProps {
  recipes: ShoppingListRecipe[];
  onOpenRecipe: (recipe: ShoppingListRecipe) => void;
  onRemoveRecipe: (recipe: ShoppingListRecipe) => void;
  onAddRecipe: () => void;
}

/**
 * The recipes on the list as small photo tiles. The × takes a recipe's
 * ingredients off the list; the last tile adds another recipe.
 */
export const ShoppingListRecipeStrip = memo(
  ({
    recipes,
    onOpenRecipe,
    onRemoveRecipe,
    onAddRecipe,
  }: ShoppingListRecipeStripProps) => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}
    >
      {recipes.map((recipe) => {
        const imageUrl = recipe.imageUrl
          ? getImageUrl(recipe.imageUrl, "recipe-thumb")
          : undefined;
        return (
          <View key={recipe.id} style={styles.tile}>
            <Pressable
              onPress={() => onOpenRecipe(recipe)}
              accessibilityRole="button"
              accessibilityLabel={recipe.name}
              accessibilityHint="Opens the recipe"
              style={({ pressed }) => pressed && styles.pressed}
            >
              {imageUrl ? (
                <Image
                  source={{ uri: imageUrl }}
                  style={styles.photo}
                  contentFit="cover"
                />
              ) : (
                <View style={[styles.photo, styles.photoEmpty]}>
                  <Ionicons
                    name="restaurant"
                    size={24}
                    style={styles.emptyIcon}
                  />
                </View>
              )}
              <Text type="caption" numberOfLines={2} style={styles.name}>
                {recipe.name}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => onRemoveRecipe(recipe)}
              hitSlop={10}
              style={styles.remove}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${recipe.name} from the list`}
            >
              <BlurView intensity={30} tint="dark" style={styles.removeBlur}>
                <Ionicons name="close" size={13} color="#fff" />
              </BlurView>
            </Pressable>
          </View>
        );
      })}

      <Pressable
        onPress={onAddRecipe}
        style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Add a recipe to the list"
      >
        <View style={[styles.photo, styles.addPhoto]}>
          <Ionicons name="add" size={30} style={styles.addIcon} />
        </View>
        <Text type="caption" numberOfLines={2} style={styles.addName}>
          Add recipe
        </Text>
      </Pressable>
    </ScrollView>
  ),
);

ShoppingListRecipeStrip.displayName = "ShoppingListRecipeStrip";

const styles = StyleSheet.create((theme) => ({
  strip: {
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 4,
  },
  tile: {
    width: TILE_SIZE,
  },
  pressed: {
    opacity: 0.7,
  },
  photo: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: 18,
  },
  photoEmpty: {
    backgroundColor: theme.colors.inputBackground,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyIcon: {
    color: theme.colors.textSecondary,
  },
  name: {
    marginTop: 6,
    fontFamily: theme.fonts.bold,
    color: theme.colors.text,
  },
  remove: {
    position: "absolute",
    top: 5,
    right: 5,
  },
  removeBlur: {
    width: 22,
    height: 22,
    borderRadius: 11,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.2)",
  },
  addPhoto: {
    backgroundColor: theme.colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  addIcon: {
    color: theme.colors.primary,
  },
  addName: {
    marginTop: 6,
    fontFamily: theme.fonts.bold,
    color: theme.colors.primary,
  },
}));
