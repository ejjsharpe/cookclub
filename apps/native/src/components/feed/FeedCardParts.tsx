import type { RecipeMetadata } from "@repo/contracts/feed";
import { memo, useCallback, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { ActivityPostOptionsButton } from "@/components/ActivityPostOptionsButton";
import { Avatar } from "@/components/Avatar";
import { Ionicons } from "@/components/Ionicons";
import { Text } from "@/components/Text";
import { SignatureIcon } from "@/components/icons/SignatureIcon";
import {
  getRecipeImportSocialPlatform,
  getRecipeImportSocialPlatformInfo,
} from "@/utils/socialPlatforms";

/** Horizontal inset shared by every feed card. */
export const FEED_CARD_INSET = 16;

type Actor = {
  id: string;
  name: string;
  image: string | null;
  subscriptionTier: "free" | "pro";
};

// ─── Author line ────────────────────────────────────────────────────────────
// "Priya Shah cooked this · 2h" on one line, with post options at the end.

export const FeedAuthorLine = memo(
  ({
    actor,
    action,
    timeAgo,
    onPress,
    activityId,
    onReportPress,
    blockUserId,
    onBlockPress,
  }: {
    actor: Actor;
    /** Rendered after the name in secondary colour. Can contain links. */
    action: ReactNode;
    timeAgo: string;
    onPress: () => void;
    activityId: number;
    onReportPress?: (activityEventId: number) => void;
    blockUserId?: string;
    onBlockPress?: (userId: string) => void;
  }) => (
    <View style={styles.authorRow}>
      <Pressable
        onPress={onPress}
        style={styles.authorPressable}
        accessibilityRole="button"
        accessibilityHint="Opens their profile"
      >
        <Avatar
          imageUrl={actor.image}
          name={actor.name}
          size={36}
          subscriptionTier={actor.subscriptionTier}
        />
        <Text type="subheadline" numberOfLines={2} style={styles.authorText}>
          <Text type="subheadline" style={styles.authorName}>
            {actor.name}
          </Text>{" "}
          <Text type="subheadline" style={styles.secondary}>
            {action} · {timeAgo}
          </Text>
        </Text>
      </Pressable>
      <ActivityPostOptionsButton
        activityId={activityId}
        onReportPress={onReportPress}
        blockUserId={blockUserId}
        onBlockPress={onBlockPress}
      />
    </View>
  ),
);

// ─── Stars ──────────────────────────────────────────────────────────────────

export const StarRating = memo(({ rating }: { rating: number }) => (
  <View
    style={styles.stars}
    accessible
    accessibilityRole="image"
    accessibilityLabel={`Rated ${rating} out of 5`}
  >
    {[1, 2, 3, 4, 5].map((star) => (
      <Ionicons
        key={star}
        name="star"
        size={16}
        style={star <= rating ? styles.starFilled : styles.starEmpty}
      />
    ))}
  </View>
));

// ─── Save button ────────────────────────────────────────────────────────────
// "+ Save" at the end of the like / comment row adds the recipe to your
// recipes. Once it's there it reads "✓ Saved" and opens it instead. The word
// is there because a plus on its own doesn't say what it adds to.

export const FeedSaveButton = memo(
  ({
    saved,
    recipeName,
    onPress,
  }: {
    saved: boolean;
    recipeName: string;
    onPress: () => void;
  }) => {
    const { theme } = useUnistyles();
    return (
      <Pressable
        onPress={onPress}
        hitSlop={6}
        style={({ pressed }) => [styles.save, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={
          saved
            ? `${recipeName} is in your recipes. Open it`
            : `Save ${recipeName} to your recipes`
        }
      >
        <SignatureIcon
          name="addToLibrary"
          variant={saved ? "filled" : "outline"}
          size={16}
          color={theme.colors.text}
        />
        <Text type="subheadline" style={styles.saveLabel}>
          {saved ? "Saved" : "Save"}
        </Text>
      </Pressable>
    );
  },
);

// ─── Recipe source ──────────────────────────────────────────────────────────

/**
 * A small mark for where a recipe came from: the cook's avatar, the platform
 * logo, or the website's first letter. Nothing for recipes with no source.
 */
export const FeedSourceMark = memo(({ recipe }: { recipe: RecipeMetadata }) => {
  if (recipe.sourceType === "user") {
    if (!recipe.originalOwner) return null;
    return (
      <View accessibilityElementsHidden importantForAccessibility="no">
        <Avatar
          imageUrl={recipe.originalOwner.image}
          name={recipe.originalOwner.name}
          size={18}
        />
      </View>
    );
  }
  if (recipe.sourceType !== "url") return null;

  const platform = getRecipeImportSocialPlatform(recipe.sourceUrl);
  const info = platform ? getRecipeImportSocialPlatformInfo(platform) : null;
  return (
    <View
      style={styles.sourceTile}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      {info ? (
        <Ionicons name={info.icon} size={11} color={info.color} />
      ) : (
        <Text type="caption2" style={styles.sourceTileLetter}>
          {recipe.sourceDomain.charAt(0).toLowerCase()}
        </Text>
      )}
    </View>
  );
});

/** The round marker at the end of a recipe link: ↗ when it leaves the app, › when it doesn't. */
export const FeedOpenIndicator = memo(({ external }: { external: boolean }) => {
  const { theme } = useUnistyles();
  return (
    <View
      style={styles.openIndicator}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      {external ? (
        <SignatureIcon name="external" size={16} color={theme.colors.text} />
      ) : (
        <Ionicons name="chevron-forward" size={16} color={theme.colors.text} />
      )}
    </View>
  );
});

// ─── Like / comment row ─────────────────────────────────────────────────────

export const FeedActions = memo(
  ({
    activityId,
    isLiked,
    likeCount,
    commentCount,
    onLikePress,
    onCommentPress,
    trailing,
  }: {
    activityId: number;
    isLiked: boolean;
    likeCount: number;
    commentCount: number;
    onLikePress?: (activityEventId: number) => void;
    onCommentPress?: (activityEventId: number) => void;
    trailing?: ReactNode;
  }) => {
    const { theme } = useUnistyles();
    const handleLike = useCallback(
      () => onLikePress?.(activityId),
      [activityId, onLikePress],
    );
    const handleComment = useCallback(
      () => onCommentPress?.(activityId),
      [activityId, onCommentPress],
    );

    const likeLabel = `${isLiked ? "Liked" : "Like"}${
      likeCount ? `, ${likeCount} ${likeCount === 1 ? "like" : "likes"}` : ""
    }`;
    const commentLabel = commentCount
      ? `${commentCount} ${commentCount === 1 ? "comment" : "comments"}`
      : "Comment";

    return (
      <View style={styles.actions}>
        <Pressable
          onPress={handleLike}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityState={{ selected: isLiked }}
          accessibilityLabel={likeLabel}
        >
          <SignatureIcon
            name="heart"
            variant={isLiked ? "filled" : "outline"}
            size={23}
            color={isLiked ? theme.colors.primary : theme.colors.text}
          />
          {likeCount ? (
            <Text
              type="subheadline"
              style={[styles.actionCount, isLiked && styles.liked]}
            >
              {likeCount}
            </Text>
          ) : null}
        </Pressable>
        <Pressable
          onPress={handleComment}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={commentLabel}
        >
          <SignatureIcon name="comment" size={25} color={theme.colors.text} />
          {commentCount ? (
            <Text type="subheadline" style={styles.actionCount}>
              {commentCount}
            </Text>
          ) : null}
        </Pressable>
        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      </View>
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  authorPressable: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  authorText: {
    flex: 1,
  },
  authorName: {
    fontFamily: theme.fonts.bold,
  },
  secondary: {
    color: theme.colors.textSecondary,
  },
  stars: {
    flexDirection: "row",
    gap: 2,
  },
  starFilled: {
    color: theme.colors.primary,
  },
  starEmpty: {
    color: theme.colors.border,
  },
  sourceTile: {
    width: 18,
    height: 18,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  sourceTileLetter: {
    fontSize: 10,
    lineHeight: 12,
    fontFamily: theme.fonts.bold,
    color: theme.colors.text,
  },
  openIndicator: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: -10,
  },
  action: {
    height: 44,
    minWidth: 44,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  actionCount: {
    fontFamily: theme.fonts.bold,
  },
  liked: {
    color: theme.colors.primary,
  },
  trailing: {
    marginLeft: "auto",
    // The row bleeds 10pt so icons line up; pull the trailing control back in.
    marginRight: 10,
  },
  pressed: {
    opacity: 0.6,
  },
  save: {
    height: 34,
    paddingLeft: 11,
    paddingRight: 14,
    borderRadius: 17,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: theme.colors.inputBackground,
  },
  saveLabel: {
    fontFamily: theme.fonts.bold,
  },
}));

/** Hairline between feed cards. Cards add their own top padding. */
export const FeedSeparator = () => <View style={separatorStyles.line} />;

const separatorStyles = StyleSheet.create((theme) => ({
  line: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
    marginTop: 6,
    marginBottom: 4,
  },
}));
