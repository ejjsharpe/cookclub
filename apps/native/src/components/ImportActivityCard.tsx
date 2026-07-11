import { formatDistanceToNow } from "date-fns";
import { LinearGradient } from "expo-linear-gradient";
import * as WebBrowser from "expo-web-browser";
import { memo, useMemo, useCallback } from "react";
import { View, TouchableOpacity } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Text } from "./Text";

import type { RecipeImportFeedItem } from "@/api/activity";
import { ActivityActionRow } from "@/components/ActivityActionRow";
import { Avatar } from "@/components/Avatar";
import { OptimizedImage } from "@/components/OptimizedImage";
import { RecipeDestinationLabel } from "@/components/RecipeDestinationLabel";
import type { ImagePreset } from "@/utils/imageUrl";

interface Props {
  activity: RecipeImportFeedItem;
  onRecipePress?: (recipeId: number) => void;
  onUserPress?: (userId: string) => void;
  onLikePress?: (activityEventId: number) => void;
  onImportPress?: (sourceUrl: string) => void;
  onImportRecipePress?: (recipeId: number) => void;
  onViewSourcePress?: () => void;
  onCommentPress?: (activityEventId: number) => void;
  currentUserId?: string;
  timeAgo?: string;
  sourceDescription?: string;
  imagePreset: ImagePreset;
  imagePriority?: "low" | "normal" | "high";
}

const ImportUserHeader = memo(
  ({
    actor,
    timeAgo,
    sourceDescription,
    onPress,
  }: {
    actor: RecipeImportFeedItem["actor"];
    timeAgo: string;
    sourceDescription: string;
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
        <View style={styles.userNameRow}>
          <View style={styles.nameGroup}>
            <View style={styles.displayNameRow}>
              <Text type="headline" numberOfLines={1} style={styles.userName}>
                {actor.name}
              </Text>
            </View>
            {actor.username && (
              <Text type="footnote" numberOfLines={1} style={styles.username}>
                @{actor.username}
              </Text>
            )}
          </View>
          <Text type="footnote" style={styles.timeAgo}>
            {timeAgo}
          </Text>
        </View>
        <Text type="subheadline" style={styles.activityText}>
          imported from {sourceDescription}
        </Text>
      </View>
    </TouchableOpacity>
  ),
);

const ImportRecipeHero = memo(
  ({
    recipe,
    onRecipePress,
    onViewSource,
    imagePreset,
    imagePriority,
  }: {
    recipe: RecipeImportFeedItem["recipe"];
    onRecipePress: () => void;
    onViewSource: () => void;
    imagePreset: ImagePreset;
    imagePriority: "low" | "normal" | "high";
  }) => (
    <TouchableOpacity
      style={styles.imageContainer}
      onPress={recipe.sourceType === "url" ? onViewSource : onRecipePress}
      activeOpacity={0.9}
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
          preset={imagePreset}
          style={styles.recipeImage}
          priority={imagePriority}
          decodeFormat="rgb"
          transition={0}
        />
      )}
      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.6)"]}
        style={styles.imageGradient}
      >
        <Text type="title3" numberOfLines={2} style={styles.recipeTitle}>
          {recipe.name}
        </Text>
        <RecipeDestinationLabel
          isExternal={recipe.sourceType === "url"}
          sourceLabel={
            recipe.sourceType === "url" ? recipe.sourceDomain : undefined
          }
          sourceUrl={recipe.sourceType === "url" ? recipe.sourceUrl : undefined}
          variant="image"
        />
      </LinearGradient>
    </TouchableOpacity>
  ),
);

export const ImportActivityCard = memo(
  ({
    activity,
    onRecipePress,
    onUserPress,
    onLikePress,
    onImportPress,
    onImportRecipePress,
    onCommentPress,
    currentUserId,
    timeAgo: providedTimeAgo,
    sourceDescription: providedSourceDescription,
    imagePreset,
    imagePriority = "normal",
  }: Props) => {
    const activityId = useMemo(() => parseInt(activity.id, 10), [activity.id]);
    const isCurrentUserRecipe =
      activity.recipe.ownerId === currentUserId ||
      activity.actor.id === currentUserId;

    const timeAgo = useMemo(
      () =>
        providedTimeAgo ??
        formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true }),
      [activity.createdAt, providedTimeAgo],
    );

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

    const sourceDescription = useMemo(() => {
      if (providedSourceDescription) return providedSourceDescription;
      if (activity.recipe.sourceType === "url") {
        return activity.recipe.sourceDomain;
      }
      switch (activity.recipe.sourceType) {
        case "text":
          return "text";
        case "image":
          return "an image";
        case "ai":
          return "AI";
        case "user":
          return "another user";
        case "manual":
          return "scratch";
        default:
          return "their collection";
      }
    }, [activity.recipe, providedSourceDescription]);

    return (
      <View style={styles.card}>
        <ImportUserHeader
          actor={activity.actor}
          timeAgo={timeAgo}
          sourceDescription={sourceDescription}
          onPress={handleUserPress}
        />

        <ImportRecipeHero
          recipe={activity.recipe}
          onRecipePress={handleRecipePress}
          onViewSource={handleViewSource}
          imagePreset={imagePreset}
          imagePriority={imagePriority}
        />

        <ActivityActionRow
          activityId={activityId}
          isLiked={activity.isLiked}
          likeCount={activity.likeCount}
          onLikePress={onLikePress}
          onCommentPress={onCommentPress}
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
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
  },
  userInfo: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  userNameRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  nameGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  displayNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flexShrink: 1,
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
  imageContainer: {
    marginHorizontal: 20,
    borderRadius: theme.borderRadius.large,
    overflow: "hidden",
  },
  recipeImage: {
    width: "100%",
    aspectRatio: 4 / 3,
  },
  imageGradient: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 14,
    paddingTop: 40,
    gap: 2,
  },
  recipeTitle: {
    color: "#FFFFFF",
  },
}));
