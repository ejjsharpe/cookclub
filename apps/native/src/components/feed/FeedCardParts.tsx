import { memo, useCallback, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { ActivityPostOptionsButton } from "@/components/ActivityPostOptionsButton";
import { Avatar } from "@/components/Avatar";
import { Ionicons } from "@/components/Ionicons";
import { Text } from "@/components/Text";
import { SignatureIcon } from "@/components/icons/SignatureIcon";

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

export const FeedSaveButton = memo(
  ({
    label,
    recipeName,
    onPress,
  }: {
    label: string;
    recipeName: string;
    onPress: () => void;
  }) => (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.saveButton, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${recipeName}`}
    >
      <Text type="subheadline" style={styles.saveLabel}>
        {label}
      </Text>
    </Pressable>
  ),
);

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
  saveButton: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 18,
    justifyContent: "center",
    backgroundColor: theme.colors.primarySoft,
  },
  saveLabel: {
    color: theme.colors.onPrimarySoft,
    fontFamily: theme.fonts.bold,
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
    paddingRight: 10,
  },
  pressed: {
    opacity: 0.6,
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
