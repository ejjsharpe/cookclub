import { LinearGradient } from "expo-linear-gradient";
import { memo } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import type { CollectionRecipe } from "@/api/collection";
import { OptimizedImage } from "@/components/OptimizedImage";
import { SystemIcon } from "@/components/SystemIcon";
import { Text } from "@/components/Text";
import { sourceHost } from "@/utils/sourceHost";
import { formatMinutesShort } from "@/utils/timeUtils";

export const COVER_HEIGHT = 200;
const ROW_IMAGE_SIZE = 60;

const recipeCount = (count: number) =>
  `${count} ${count === 1 ? "recipe" : "recipes"}`;

/**
 * The collection's name and count on a photo of its newest recipe, as a
 * rounded card. Without a photo it's a plain large title.
 */
export const CollectionCover = ({
  name,
  count,
  image,
}: {
  name: string;
  count: number;
  image: string | null;
}) => {
  if (!image) {
    return (
      <View style={styles.plainTitle}>
        <Text type="largeTitle" accessibilityRole="header">
          {name}
        </Text>
        <Text type="subheadline" style={styles.muted}>
          {count === 0 ? "No recipes yet" : recipeCount(count)}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.cover}>
      <OptimizedImage
        image={image}
        preset="recipe-hero"
        style={StyleSheet.absoluteFill}
        accessible={false}
      />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.6)"]}
        style={styles.coverShade}
      />
      <View style={styles.coverText}>
        <Text
          type="title1"
          numberOfLines={2}
          accessibilityRole="header"
          style={styles.coverName}
        >
          {name}
        </Text>
        <Text type="subheadline" style={styles.coverCount}>
          {recipeCount(count)}
        </Text>
      </View>
    </View>
  );
};

/** A recipe in the collection: photo, name, then time and where it's from. */
export const CollectionRecipeRow = memo(function CollectionRecipeRow({
  recipe,
  onPress,
}: {
  recipe: CollectionRecipe;
  onPress: (recipeId: number) => void;
}) {
  const { theme } = useUnistyles();
  const meta = [
    formatMinutesShort(recipe.totalTime),
    sourceHost(recipe.sourceUrl),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Pressable
      onPress={() => onPress(recipe.id)}
      accessibilityRole="button"
      accessibilityLabel={meta ? `${recipe.name}, ${meta}` : recipe.name}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {recipe.coverImage ? (
        <OptimizedImage
          image={recipe.coverImage}
          preset="recipe-thumb"
          style={styles.rowImage}
          accessible={false}
        />
      ) : (
        <View style={[styles.rowImage, styles.placeholder]}>
          <SystemIcon
            sf="fork.knife"
            android="restaurant"
            size={22}
            color={theme.colors.textTertiary}
          />
        </View>
      )}
      <View style={styles.rowText}>
        <Text type="callout" style={styles.bold} numberOfLines={1}>
          {recipe.name}
        </Text>
        {meta ? (
          <Text type="subheadline" style={styles.muted} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create((theme) => ({
  pressed: {
    opacity: 0.6,
  },
  bold: {
    fontFamily: theme.fonts.bold,
  },
  muted: {
    color: theme.colors.textSecondary,
  },
  plainTitle: {
    paddingHorizontal: 20,
    gap: 2,
  },
  cover: {
    height: COVER_HEIGHT,
    marginHorizontal: 16,
    borderRadius: 26,
    overflow: "hidden",
    justifyContent: "flex-end",
    backgroundColor: theme.colors.inputBackground,
  },
  coverShade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 130,
  },
  coverText: {
    paddingHorizontal: 18,
    paddingBottom: 14,
  },
  coverName: {
    color: "#FFFFFF",
  },
  coverCount: {
    color: "rgba(255,255,255,0.88)",
    fontFamily: theme.fonts.semiBold,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 7,
  },
  rowImage: {
    width: ROW_IMAGE_SIZE,
    height: ROW_IMAGE_SIZE,
    borderRadius: 14,
    overflow: "hidden",
  },
  placeholder: {
    backgroundColor: theme.colors.inputBackground,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
}));
