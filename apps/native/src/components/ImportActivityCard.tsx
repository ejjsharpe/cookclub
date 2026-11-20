import { memo, useMemo, useCallback } from "react";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Text } from "./Text";

import type { RecipeImportFeedItem } from "@/api/activity";
import { OptimizedImage } from "@/components/OptimizedImage";
import { ScalePressable } from "@/components/buttons/ScalePressable";
import {
  FEED_CARD_INSET,
  FeedActions,
  FeedAuthorLine,
  FeedSaveButton,
  FeedSourceMark,
} from "@/components/feed/FeedCardParts";
import { SignatureIcon } from "@/components/icons/SignatureIcon";
import { openExternalWebsite } from "@/lib/externalBrowser";
import {
  formatFeedRecipeDetails,
  formatFeedRecipeMeta,
  getFeedRecipeSource,
} from "@/utils/feedRecipeMeta";
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
    const { theme } = useUnistyles();
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

    const source = getFeedRecipeSource(recipe);
    // With a photo, the source sits on it as a chip, so leave it out here.
    const meta =
      source && recipe.image
        ? formatFeedRecipeDetails(recipe)
        : formatFeedRecipeMeta(recipe);

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

        <ScalePressable
          pressedScale={0.98}
          style={styles.recipe}
          onPress={isExternal ? handleViewSource : handleRecipePress}
          accessibilityRole={isExternal ? "link" : "button"}
          accessibilityLabel={`${recipe.name}. Opens ${
            recipe.sourceType === "url"
              ? `recipe website, ${recipe.sourceDomain}`
              : "in app"
          }`}
        >
          {recipe.image ? (
            <View>
              <OptimizedImage
                image={recipe.image}
                preset={imagePreset}
                style={styles.recipeImage}
                priority={imagePriority}
                decodeFormat="rgb"
                transition={0}
              />
              {source ? (
                <View style={styles.sourceChip}>
                  <FeedSourceMark recipe={recipe} />
                  <Text
                    type="footnote"
                    numberOfLines={1}
                    style={styles.sourceChipLabel}
                  >
                    {source}
                  </Text>
                  {isExternal ? (
                    <SignatureIcon
                      name="external"
                      size={14}
                      color={theme.colors.text}
                    />
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}
          <View style={styles.recipeInfo}>
            <Text type="title3" numberOfLines={2} style={styles.recipeTitle}>
              {recipe.name}
            </Text>
            {meta ? (
              <View style={styles.metaRow}>
                {/* Without a photo there's no chip, so show the source here. */}
                {recipe.image ? null : <FeedSourceMark recipe={recipe} />}
                <Text type="footnote" numberOfLines={1} style={styles.meta}>
                  {meta}
                </Text>
              </View>
            ) : null}
          </View>
        </ScalePressable>

        <FeedActions
          activityId={activityId}
          isLiked={activity.isLiked}
          likeCount={activity.likeCount}
          commentCount={activity.commentCount}
          onLikePress={onLikePress}
          onCommentPress={onCommentPress}
          trailing={
            <FeedSaveButton
              saved={isCurrentUserRecipe}
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
    flexShrink: 1,
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
  // Solid rather than glass: glass is too costly in a scrolling list.
  sourceChip: {
    position: "absolute",
    left: 12,
    bottom: 12,
    maxWidth: "80%",
    height: 32,
    paddingLeft: 8,
    paddingRight: 12,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: theme.colors.photoChip,
  },
  sourceChipLabel: {
    flexShrink: 1,
    fontFamily: theme.fonts.bold,
    color: theme.colors.text,
  },
  recipeInfo: {
    gap: 2,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  recipeTitle: {
    fontSize: 18,
    lineHeight: 23,
  },
}));
