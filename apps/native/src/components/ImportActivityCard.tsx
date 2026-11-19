import { memo, useMemo, useCallback } from "react";
import { View, Pressable } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Text } from "./Text";

import type { RecipeImportFeedItem } from "@/api/activity";
import { OptimizedImage } from "@/components/OptimizedImage";
import {
  FEED_CARD_INSET,
  FeedActions,
  FeedAuthorLine,
  FeedSaveButton,
} from "@/components/feed/FeedCardParts";
import { openExternalWebsite } from "@/lib/externalBrowser";
import { formatFeedRecipeMeta } from "@/utils/feedRecipeMeta";
import type { ImagePreset } from "@/utils/imageUrl";
import { formatRelativeTimeShort } from "@/utils/relativeTime";

interface Props {
  activity: RecipeImportFeedItem;
  onRecipePress?: (recipeId: number) => void;
  onUserPress?: (userId: string) => void;
  onLikePress?: (activityEventId: number) => void;
  onImportPress?: (sourceUrl: string) => void;
  onImportRecipePress?: (recipeId: number) => void;
  onViewSourcePress?: () => void;
  onCommentPress?: (activityEventId: number) => void;
  onReportPress?: (activityEventId: number) => void;
  onBlockPress?: (userId: string) => void;
  currentUserId?: string;
  timeAgo?: string;
  imagePreset: ImagePreset;
  imagePriority?: "low" | "normal" | "high";
}

export const ImportActivityCard = memo(
  ({
    activity,
    onRecipePress,
    onUserPress,
    onLikePress,
    onImportPress,
    onImportRecipePress,
    onCommentPress,
    onReportPress,
    onBlockPress,
    currentUserId,
    timeAgo: providedTimeAgo,
    imagePreset,
    imagePriority = "normal",
  }: Props) => {
    const activityId = useMemo(() => parseInt(activity.id, 10), [activity.id]);
    const isCurrentUserRecipe =
      activity.recipe.ownerId === currentUserId ||
      activity.actor.id === currentUserId;

    const timeAgo = useMemo(
      () => providedTimeAgo ?? formatRelativeTimeShort(activity.createdAt),
      [activity.createdAt, providedTimeAgo],
    );

    const handleViewSource = useCallback(async () => {
      if (activity.recipe.sourceType === "url") {
        await openExternalWebsite(activity.recipe.sourceUrl);
      }
    }, [activity.recipe]);

    const handleRecipePress = useCallback(() => {
      onRecipePress?.(activity.recipe.id);
    }, [activity.recipe.id, onRecipePress]);

    const handleUserPress = useCallback(() => {
      onUserPress?.(activity.actor.id);
    }, [activity.actor.id, onUserPress]);

    const handleImport = useCallback(() => {
      if (isCurrentUserRecipe) {
        onRecipePress?.(activity.recipe.id);
        return;
      }
      if (activity.recipe.sourceType === "url") {
        onImportPress?.(activity.recipe.sourceUrl);
      } else {
        onImportRecipePress?.(activity.recipe.id);
      }
    }, [
      activity.recipe,
      isCurrentUserRecipe,
      onImportPress,
      onImportRecipePress,
      onRecipePress,
    ]);

    // Kept to one line; where it came from goes in the meta line instead.
    const action =
      activity.recipe.sourceType === "manual"
        ? "wrote a recipe"
        : activity.recipe.sourceType === "ai"
          ? "made a recipe with AI"
          : "saved a recipe";

    const recipe = activity.recipe;
    const isExternal = recipe.sourceType === "url";
    const isOwnPost = activity.actor.id === currentUserId;

    const meta = formatFeedRecipeMeta(recipe);

    return (
      <View style={styles.card}>
        <FeedAuthorLine
          actor={activity.actor}
          action={action}
          timeAgo={timeAgo}
          onPress={handleUserPress}
          activityId={activityId}
          onReportPress={isOwnPost ? undefined : onReportPress}
          blockUserId={isOwnPost ? undefined : activity.actor.id}
          onBlockPress={onBlockPress}
        />

        <Pressable
          style={({ pressed }) => [styles.recipe, pressed && styles.pressed]}
          onPress={isExternal ? handleViewSource : handleRecipePress}
          accessibilityRole="button"
          accessibilityLabel={`${recipe.name}. Opens ${
            recipe.sourceType === "url"
              ? `recipe website, ${recipe.sourceDomain}`
              : "in app"
          }`}
        >
          {recipe.image ? (
            <OptimizedImage
              image={recipe.image}
              preset={imagePreset}
              style={styles.recipeImage}
              priority={imagePriority}
              decodeFormat="rgb"
              transition={0}
            />
          ) : null}
          <View style={styles.recipeInfo}>
            <Text type="title3" numberOfLines={2} style={styles.recipeTitle}>
              {recipe.name}
            </Text>
            {meta ? (
              <Text type="footnote" numberOfLines={1} style={styles.meta}>
                {meta}
              </Text>
            ) : null}
          </View>
        </Pressable>

        <FeedActions
          activityId={activityId}
          isLiked={activity.isLiked}
          likeCount={activity.likeCount}
          commentCount={activity.commentCount}
          onLikePress={onLikePress}
          onCommentPress={onCommentPress}
          trailing={
            <FeedSaveButton
              label={isCurrentUserRecipe ? "View" : "Save"}
              recipeName={recipe.name}
              onPress={handleImport}
            />
          }
        />
      </View>
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  card: {
    backgroundColor: theme.colors.background,
    paddingHorizontal: FEED_CARD_INSET,
    paddingTop: 12,
    gap: 10,
  },
  meta: {
    color: theme.colors.textSecondary,
  },
  recipe: {
    gap: 10,
  },
  recipeImage: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: 22,
  },
  recipeInfo: {
    gap: 2,
  },
  recipeTitle: {
    fontSize: 18,
    lineHeight: 23,
  },
  pressed: {
    opacity: 0.85,
  },
}));
