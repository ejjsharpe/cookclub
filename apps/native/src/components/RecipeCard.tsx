import type { PublicImageAsset } from "@repo/contracts/images";
import { memo, useCallback, useMemo } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Text } from "./Text";

import { Ionicons } from "@/components/Ionicons";
import { OptimizedImage } from "@/components/OptimizedImage";
import { RecipeDestinationLabel } from "@/components/RecipeDestinationLabel";
import { formatMinutes } from "@/utils/timeUtils";

interface Tag {
  id: number;
  name: string;
}

interface User {
  id: string;
  name: string;
  image?: string | null;
}

interface Recipe {
  id: number;
  name: string;
  description?: string | null;
  prepTime?: number | null;
  cookTime?: number | null;
  totalTime?: number | null;
  coverImage?: PublicImageAsset | string | null;
  tags?: Tag[];
  owner?: User;
  sourceUrl?: string | null;
}

interface Props {
  recipe: Recipe;
  onPress?: () => void;
  onPressRecipeId?: (recipeId: number) => void;
}

export const RecipeCard = memo(function RecipeCard({
  recipe,
  onPress,
  onPressRecipeId,
}: Props) {
  const sourceHost = useMemo(() => {
    if (!recipe.sourceUrl) return null;

    try {
      return new URL(recipe.sourceUrl).hostname.replace(/^www\./, "");
    } catch {
      return recipe.sourceUrl.replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
    }
  }, [recipe.sourceUrl]);

  const handlePress = useCallback(() => {
    if (onPressRecipeId) {
      onPressRecipeId(recipe.id);
      return;
    }
    onPress?.();
  }, [onPress, onPressRecipeId, recipe.id]);
  const pressHandler = onPress || onPressRecipeId ? handlePress : undefined;

  return (
    <Pressable style={styles.card} onPress={pressHandler}>
      {({ pressed }) => (
        <>
          {pressed && (
            <View pointerEvents="none" style={styles.pressHighlight} />
          )}
          <View style={styles.thumbnail}>
            {recipe.coverImage ? (
              <OptimizedImage
                image={recipe.coverImage}
                preset="thumb_200"
                style={styles.thumbnailImage}
                contentFit="cover"
                decodeFormat="rgb"
              />
            ) : (
              <View style={styles.thumbnailPlaceholder}>
                <Ionicons
                  name="image-outline"
                  size={32}
                  style={styles.placeholderIcon}
                />
              </View>
            )}
          </View>

          <View style={styles.content}>
            <Text type="headline" numberOfLines={2}>
              {recipe.name}
            </Text>
            {recipe.totalTime && (
              <View style={styles.metaItem}>
                <Ionicons
                  name="time-outline"
                  size={14}
                  style={styles.metaIcon}
                />
                <Text type="subheadline" style={styles.metaText}>
                  {formatMinutes(recipe.totalTime)}
                </Text>
              </View>
            )}
            {sourceHost && (
              <View style={styles.metaItem}>
                <RecipeDestinationLabel
                  isExternal
                  sourceLabel={sourceHost}
                  sourceUrl={recipe.sourceUrl ?? undefined}
                />
              </View>
            )}
          </View>

          <Ionicons name="chevron-forward" size={20} style={styles.chevron} />
        </>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create((theme) => ({
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.background,
    paddingHorizontal: 20,
    gap: 14,
    position: "relative",
  },
  pressHighlight: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.pressHighlight,
  },
  thumbnail: {
    width: 100,
    height: 100,
    borderRadius: theme.borderRadius.medium,
    overflow: "hidden",
  },
  thumbnailImage: {
    width: "100%",
    height: "100%",
  },
  thumbnailPlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: theme.colors.inputBackground,
    justifyContent: "center",
    alignItems: "center",
  },
  placeholderIcon: {
    color: theme.colors.textTertiary,
  },
  content: {
    flex: 1,
    gap: 4,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 20,
    gap: 4,
  },
  metaIcon: {
    color: theme.colors.textSecondary,
    marginTop: 1,
  },
  metaText: {
    color: theme.colors.textSecondary,
  },
  chevron: {
    color: theme.colors.textTertiary,
  },
}));
