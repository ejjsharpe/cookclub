import * as WebBrowser from "expo-web-browser";
import { memo, useMemo, useCallback } from "react";
import { View, TouchableOpacity, ScrollView } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Text } from "./Text";

import type { CookingReviewFeedItem } from "@/api/activity";
import { ActivityActionRow } from "@/components/ActivityActionRow";
import { Avatar } from "@/components/Avatar";
import { Ionicons } from "@/components/Ionicons";
import { OptimizedImage } from "@/components/OptimizedImage";
import { RecipeDestinationLabel } from "@/components/RecipeDestinationLabel";
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

const StarRating = ({ rating }: { rating: number }) => {
  return (
    <View style={starStyles.container}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Ionicons
          key={star}
          name={star <= rating ? "star" : "star-outline"}
          size={14}
          style={star <= rating ? starStyles.filled : starStyles.empty}
        />
      ))}
    </View>
  );
};

const starStyles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    gap: 2,
  },
  filled: {
    color: theme.colors.primary,
  },
  empty: {
    color: theme.colors.border,
  },
}));

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
  }) => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToInterval={imageWidth + 8}
      decelerationRate="fast"
      contentContainerStyle={styles.carouselContent}
    >
      {images.map((item, index) => (
        <View
          key={item.storageKey}
          style={[
            styles.imageWrapper,
            { width: imageWidth },
            index < images.length - 1 && styles.imageItemGap,
          ]}
        >
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
  ),
);

const ActivityUserHeader = memo(
  ({
    actor,
    timeAgo,
    actionText,
    onPress,
  }: {
    actor: CookingReviewFeedItem["actor"];
    timeAgo: string;
    actionText: string;
    onPress: () => void;
  }) => (
    <TouchableOpacity
      style={styles.userHeader}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Avatar
        imageUrl={actor.image}
        name={actor.name}
        size={44}
        subscriptionTier={actor.subscriptionTier}
      />
      <View style={styles.userInfo}>
        <View style={styles.titleRow}>
          <Text type="headline" numberOfLines={1} style={styles.userName}>
            {actor.name}
          </Text>
          {actor.username ? (
            <Text type="footnote" numberOfLines={1} style={styles.username}>
              @{actor.username}
            </Text>
          ) : null}
          <Text type="footnote" style={styles.timeAgo}>
            · {timeAgo}
          </Text>
        </View>
        <Text type="subheadline" numberOfLines={2} style={styles.activityText}>
          {actionText}
        </Text>
      </View>
    </TouchableOpacity>
  ),
);

const ReviewContentCard = memo(
  ({
    review,
    recipe,
    onRecipePress,
    onViewSource,
    imagePriority,
  }: {
    review: CookingReviewFeedItem["review"];
    recipe: CookingReviewFeedItem["recipe"];
    onRecipePress: () => void;
    onViewSource: () => void;
    imagePriority: "low" | "normal" | "high";
  }) => (
    <View style={styles.contentCardWrapper}>
      <View style={styles.contentCard}>
        <View style={styles.reviewContent}>
          <View style={styles.ratingRow}>
            <StarRating rating={review.rating} />
            <Text type="footnote" style={styles.ratingText}>
              {review.rating}/5
            </Text>
          </View>

          {review.text && (
            <Text type="body" style={styles.reviewText}>
              {review.text}
            </Text>
          )}
        </View>

        <TouchableOpacity
          style={styles.recipePreview}
          onPress={recipe.sourceType === "url" ? onViewSource : onRecipePress}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`${recipe.name}. Opens ${
            recipe.sourceType === "url"
              ? `recipe website, ${recipe.sourceDomain}`
              : "in app"
          }`}
        >
          {recipe.image && (
            <OptimizedImage
              image={recipe.image}
              preset="thumb_200"
              style={styles.recipeImage}
              priority={imagePriority}
              decodeFormat="rgb"
              transition={0}
            />
          )}
          <View style={styles.recipeInfo}>
            <Text type="headline" numberOfLines={2} style={styles.recipeTitle}>
              {recipe.name}
            </Text>
            <RecipeDestinationLabel
              isExternal={recipe.sourceType === "url"}
              sourceLabel={
                recipe.sourceType === "url" ? recipe.sourceDomain : undefined
              }
              sourceUrl={
                recipe.sourceType === "url" ? recipe.sourceUrl : undefined
              }
            />
          </View>
        </TouchableOpacity>
      </View>
    </View>
  ),
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
    const isCurrentUserRecipe = activity.recipe.ownerId === currentUserId;

    const timeAgo = useMemo(
      () => providedTimeAgo ?? formatRelativeTimeShort(activity.createdAt),
      [activity.createdAt, providedTimeAgo],
    );

    const hasImages = activity.review.images.length > 0;

    const handleViewSource = useCallback(async () => {
      if (activity.recipe.sourceType === "url") {
        await WebBrowser.openBrowserAsync(activity.recipe.sourceUrl);
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
        <ActivityUserHeader
          actor={activity.actor}
          timeAgo={timeAgo}
          actionText={`cooked ${activity.recipe.name}`}
          onPress={handleUserPress}
        />

        {/* Review Images Carousel */}
        {hasImages && (
          <View style={styles.carouselContainer}>
            <ReviewImageCarousel
              images={activity.review.images}
              imageWidth={imageWidth}
              preset={imagePreset}
              priority={imagePriority}
            />
          </View>
        )}

        <ReviewContentCard
          review={activity.review}
          recipe={activity.recipe}
          onRecipePress={handleRecipePress}
          onViewSource={handleViewSource}
          imagePriority={imagePriority}
        />

        <ActivityActionRow
          activityId={activityId}
          isLiked={activity.isLiked}
          likeCount={activity.likeCount}
          onLikePress={onLikePress}
          onCommentPress={onCommentPress}
          onReportPress={
            activity.actor.id === currentUserId ? undefined : onReportPress
          }
          blockUserId={
            activity.actor.id === currentUserId ? undefined : activity.actor.id
          }
          onBlockPress={onBlockPress}
          onImportPress={handleImport}
          primaryActionLabel={isCurrentUserRecipe ? "View Recipe" : "Import"}
          primaryActionIcon={isCurrentUserRecipe ? "book-outline" : "add"}
        />
      </View>
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  card: {
    backgroundColor: theme.colors.background,
    paddingVertical: 16,
    gap: 12,
  },
  userHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 20,
  },
  userInfo: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    minWidth: 0,
  },
  userName: {
    flexShrink: 1,
  },
  username: {
    color: theme.colors.textSecondary,
    flexShrink: 2,
  },
  timeAgo: {
    color: theme.colors.textSecondary,
    flexShrink: 0,
  },
  activityText: {
    color: theme.colors.textSecondary,
  },
  carouselContainer: {},
  carouselContent: {
    paddingHorizontal: 20,
  },
  imageWrapper: {
    borderRadius: theme.borderRadius.large,
    overflow: "hidden",
  },
  imageItemGap: {
    marginRight: 8,
  },
  reviewImage: {
    width: "100%",
    aspectRatio: 4 / 3,
  },
  contentCardWrapper: {
    paddingHorizontal: 20,
  },
  contentCard: {
    backgroundColor: theme.colors.inputBackground,
    borderRadius: theme.borderRadius.large,
    overflow: "hidden",
  },
  reviewContent: {
    padding: 16,
    gap: 8,
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  ratingText: {
    color: theme.colors.textSecondary,
  },
  reviewText: {},
  recipePreview: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    gap: 12,
  },
  recipeImage: {
    width: 56,
    height: 56,
    borderRadius: theme.borderRadius.medium,
  },
  recipeInfo: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  recipeTitle: {},
}));
