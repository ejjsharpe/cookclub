import { memo, useMemo, useCallback } from "react";
import { View, Pressable, ScrollView } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Text } from "./Text";

import type { CookingReviewFeedItem } from "@/api/activity";
import { OptimizedImage } from "@/components/OptimizedImage";
import {
  FEED_CARD_INSET,
  FeedActions,
  FeedAuthorLine,
  FeedSaveButton,
  StarRating,
} from "@/components/feed/FeedCardParts";
import { openExternalWebsite } from "@/lib/externalBrowser";
import { formatFeedRecipeMeta } from "@/utils/feedRecipeMeta";
import type { ImagePreset } from "@/utils/imageUrl";
import { formatRelativeTimeShort } from "@/utils/relativeTime";

interface Props {
  activity: CookingReviewFeedItem;
  onRecipePress?: (recipeId: number) => void;
  onUserPress?: (userId: string) => void;
  onLikePress?: (activityEventId: number) => void;
  onImportPress?: (sourceUrl: string) => void;
  onImportRecipePress?: (recipeId: number) => void;
  onCommentPress?: (activityEventId: number) => void;
  onReportPress?: (activityEventId: number) => void;
  onBlockPress?: (userId: string) => void;
  currentUserId?: string;
  timeAgo?: string;
  imagePreset: ImagePreset;
  imageWidth: number;
  imagePriority?: "low" | "normal" | "high";
}

const ReviewImageCarousel = memo(
  ({
    images,
    imageWidth,
    preset,
    priority,
  }: {
    images: CookingReviewFeedItem["review"]["images"];
    imageWidth: number;
    preset: ImagePreset;
    priority: "low" | "normal" | "high";
  }) => {
    if (images.length === 1) {
      return (
        <OptimizedImage
          image={images[0]}
          preset={preset}
          style={styles.reviewImage}
          priority={priority}
          decodeFormat="rgb"
          transition={0}
        />
      );
    }
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={imageWidth + 8}
        decelerationRate="fast"
        style={styles.carousel}
        contentContainerStyle={styles.carouselContent}
      >
        {images.map((item, index) => (
          <View key={item.storageKey} style={{ width: imageWidth }}>
            <OptimizedImage
              image={item}
              preset={preset}
              style={styles.reviewImage}
              priority={index === 0 ? priority : "low"}
              decodeFormat="rgb"
              transition={0}
            />
          </View>
        ))}
      </ScrollView>
    );
  },
);

export const ReviewActivityCard = memo(
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
    imageWidth,
    imagePriority = "normal",
  }: Props) => {
    const activityId = useMemo(() => parseInt(activity.id, 10), [activity.id]);
    const recipe = activity.recipe;
    const isExternal = recipe.sourceType === "url";
    const isCurrentUserRecipe = recipe.ownerId === currentUserId;
    const isOwnPost = activity.actor.id === currentUserId;
    const meta = formatFeedRecipeMeta(recipe);

    const timeAgo = useMemo(
      () => providedTimeAgo ?? formatRelativeTimeShort(activity.createdAt),
      [activity.createdAt, providedTimeAgo],
    );

    const hasImages = activity.review.images.length > 0;

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

    return (
      <View style={styles.card}>
        <FeedAuthorLine
          actor={activity.actor}
          action="cooked this"
          timeAgo={timeAgo}
          onPress={handleUserPress}
          activityId={activityId}
          onReportPress={isOwnPost ? undefined : onReportPress}
          blockUserId={isOwnPost ? undefined : activity.actor.id}
          onBlockPress={onBlockPress}
        />

        {hasImages && (
          <ReviewImageCarousel
            images={activity.review.images}
            imageWidth={imageWidth}
            preset={imagePreset}
            priority={imagePriority}
          />
        )}

        <StarRating rating={activity.review.rating} />
        {activity.review.text ? (
          <Text type="callout" style={styles.reviewText}>
            {activity.review.text}
          </Text>
        ) : null}

        <View style={styles.recipeRow}>
          <Pressable
            style={({ pressed }) => [
              styles.recipeLink,
              pressed && styles.pressed,
            ]}
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
                preset="thumb_200"
                style={styles.recipeThumb}
                priority={imagePriority}
                decodeFormat="rgb"
                transition={0}
              />
            ) : null}
            <View style={styles.recipeInfo}>
              <Text type="subheadline" numberOfLines={1} style={styles.bold}>
                {recipe.name}
              </Text>
              {meta ? (
                <Text type="footnote" numberOfLines={1} style={styles.meta}>
                  {meta}
                </Text>
              ) : null}
            </View>
          </Pressable>
          <FeedSaveButton
            label={isCurrentUserRecipe ? "View" : "Save"}
            recipeName={recipe.name}
            onPress={handleImport}
          />
        </View>

        <FeedActions
          activityId={activityId}
          isLiked={activity.isLiked}
          likeCount={activity.likeCount}
          commentCount={activity.commentCount}
          onLikePress={onLikePress}
          onCommentPress={onCommentPress}
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
  carousel: {
    marginHorizontal: -FEED_CARD_INSET,
  },
  carouselContent: {
    paddingHorizontal: FEED_CARD_INSET,
    gap: 8,
  },
  reviewImage: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: 22,
  },
  reviewText: {
    marginTop: -2,
  },
  recipeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 8,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: theme.colors.border,
  },
  recipeLink: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  recipeThumb: {
    width: 48,
    height: 48,
    borderRadius: 12,
  },
  recipeInfo: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  meta: {
    color: theme.colors.textSecondary,
  },
  bold: {
    fontFamily: theme.fonts.bold,
  },
  pressed: {
    opacity: 0.6,
  },
}));
