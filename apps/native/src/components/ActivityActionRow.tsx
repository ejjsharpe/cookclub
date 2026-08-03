import { memo, useCallback } from "react";
import { TouchableOpacity, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Ionicons } from "@/components/Ionicons";
import { Text } from "@/components/Text";

interface Props {
  activityId: number;
  isLiked: boolean;
  likeCount: number;
  onLikePress?: (activityEventId: number) => void;
  onCommentPress?: (activityEventId: number) => void;
  onImportPress?: () => void;
  onReportPress?: (activityEventId: number) => void;
  blockUserId?: string;
  onBlockPress?: (userId: string) => void;
  primaryActionLabel?: string;
  primaryActionIcon?: keyof typeof Ionicons.glyphMap;
}

export const ActivityActionRow = memo(
  ({
    activityId,
    isLiked,
    likeCount,
    onLikePress,
    onCommentPress,
    onImportPress,
    onReportPress,
    blockUserId,
    onBlockPress,
    primaryActionLabel = "Import",
    primaryActionIcon = "add",
  }: Props) => {
    const handleLike = useCallback(() => {
      onLikePress?.(activityId);
    }, [activityId, onLikePress]);

    const handleComment = useCallback(() => {
      onCommentPress?.(activityId);
    }, [activityId, onCommentPress]);

    const handleReport = useCallback(() => {
      onReportPress?.(activityId);
    }, [activityId, onReportPress]);

    const handleBlock = useCallback(() => {
      if (blockUserId) onBlockPress?.(blockUserId);
    }, [blockUserId, onBlockPress]);

    return (
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={styles.actionPill}
          activeOpacity={0.7}
          onPress={handleLike}
        >
          <Ionicons
            name={isLiked ? "heart" : "heart-outline"}
            size={16}
            style={[styles.actionIcon, isLiked && styles.actionIconLiked]}
          />
          <Text type="subheadline" style={styles.actionText}>
            {likeCount || "Like"}
          </Text>
        </TouchableOpacity>
        {onReportPress ? (
          <TouchableOpacity
            accessibilityLabel="Report activity"
            style={styles.actionPill}
            activeOpacity={0.7}
            onPress={handleReport}
          >
            <Ionicons name="flag-outline" size={14} style={styles.actionIcon} />
            <Text type="subheadline" style={styles.actionText}>
              Report
            </Text>
          </TouchableOpacity>
        ) : null}
        {blockUserId && onBlockPress ? (
          <TouchableOpacity
            accessibilityLabel="Block activity author"
            style={styles.actionPill}
            activeOpacity={0.7}
            onPress={handleBlock}
          >
            <Ionicons name="ban-outline" size={14} style={styles.actionIcon} />
            <Text type="subheadline" style={styles.actionText}>
              Block
            </Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={styles.actionPill}
          activeOpacity={0.7}
          onPress={handleComment}
        >
          <Ionicons
            name="chatbubble-outline"
            size={14}
            style={styles.actionIcon}
          />
          <Text type="subheadline" style={styles.actionText}>
            Comment
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionPillPrimary}
          onPress={onImportPress}
          activeOpacity={0.7}
        >
          <Ionicons
            name={primaryActionIcon}
            size={16}
            style={styles.actionIconPrimary}
          />
          <Text type="subheadline" style={styles.actionTextPrimary}>
            {primaryActionLabel}
          </Text>
        </TouchableOpacity>
      </View>
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    paddingHorizontal: 20,
  },
  actionPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 32,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: theme.colors.inputBackground,
    borderRadius: theme.borderRadius.full,
  },
  actionIcon: {
    color: theme.colors.text,
  },
  actionIconLiked: {
    color: theme.colors.primary,
  },
  actionText: {
    color: theme.colors.text,
  },
  actionPillPrimary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 32,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.full,
  },
  actionIconPrimary: {
    color: theme.colors.buttonText,
  },
  actionTextPrimary: {
    color: theme.colors.buttonText,
  },
}));
