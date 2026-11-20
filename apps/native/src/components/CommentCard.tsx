import { parseMentionTokens } from "@repo/shared";
import { memo, useCallback, useMemo, type ReactNode } from "react";
import {
  ActionSheetIOS,
  Alert,
  Pressable,
  View,
  type AlertButton,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Avatar } from "./Avatar";
import { Ionicons } from "./Ionicons";
import { Text } from "./Text";

import type { Comment } from "@/api/comment";
import { formatRelativeTimeShort } from "@/utils/relativeTime";

export const COMMENT_AVATAR_SIZE = 34;
const REPLY_AVATAR_SIZE = 26;
const ROW_INSET = 20;
const AVATAR_GAP = 12;

interface Props {
  comment: Comment;
  isReply?: boolean;
  /** Deep-linked comment, or the one being replied to. */
  isHighlighted?: boolean;
  isOwnComment: boolean;
  /** The comment was written by whoever posted the activity. */
  isAuthor?: boolean;
  onReply: (comment: Comment) => void;
  onDelete: (commentId: number) => void;
  onReport: (commentId: number) => void;
  onBlock: (userId: string, name: string) => void;
  onUserPress: (userId: string) => void;
  onMentionPress: (userId: string) => void;
}

interface CommentOption {
  label: string;
  destructive?: boolean;
  /** Reachable elsewhere in the row, so it can give way on Android. */
  optional?: boolean;
  run: () => void;
}

// Android's alert dialog shows at most three buttons.
const ANDROID_ALERT_MAX_BUTTONS = 3;

/** Interim presenter until native context menus (Expo UI) are available. */
const presentCommentOptions = (options: CommentOption[]) => {
  if (process.env.EXPO_OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [...options.map((option) => option.label), "Cancel"],
        cancelButtonIndex: options.length,
        destructiveButtonIndex: options.flatMap((option, index) =>
          option.destructive ? [index] : [],
        ),
      },
      (buttonIndex) => options[buttonIndex]?.run(),
    );
    return;
  }

  // Drop shortcuts first so every action that only lives here stays visible;
  // the dialog can always be dismissed with back or a tap outside.
  const buttons: AlertButton[] = options
    .filter(
      (option) =>
        !option.optional || options.length < ANDROID_ALERT_MAX_BUTTONS,
    )
    .map((option) => ({
      text: option.label,
      style: option.destructive ? "destructive" : "default",
      onPress: option.run,
    }));
  if (buttons.length < ANDROID_ALERT_MAX_BUTTONS) {
    buttons.push({ text: "Cancel", style: "cancel" });
  }
  Alert.alert("Comment", undefined, buttons, { cancelable: true });
};

export const CommentCard = memo(
  ({
    comment,
    isReply = false,
    isHighlighted = false,
    isOwnComment,
    isAuthor = false,
    onReply,
    onDelete,
    onReport,
    onBlock,
    onUserPress,
    onMentionPress,
  }: Props) => {
    const timeAgo = useMemo(
      () => formatRelativeTimeShort(comment.createdAt),
      [comment.createdAt],
    );

    const renderedContent = useMemo(() => {
      const mentionByUsername = new Map(
        (comment.mentions ?? []).map((mention) => [mention.username, mention]),
      );
      const nodes: ReactNode[] = [];
      let cursor = 0;

      for (const token of parseMentionTokens(comment.content)) {
        const mention = mentionByUsername.get(token.username);
        if (!mention) continue;

        if (token.start > cursor) {
          nodes.push(comment.content.slice(cursor, token.start));
        }
        nodes.push(
          <Text
            key={`${mention.userId}-${token.start}`}
            accessibilityRole="link"
            onPress={() => onMentionPress(mention.userId)}
            style={styles.mentionText}
          >
            {comment.content.slice(token.start, token.end)}
          </Text>,
        );
        cursor = token.end;
      }

      if (cursor < comment.content.length) {
        nodes.push(comment.content.slice(cursor));
      }

      return nodes.length > 0 ? nodes : comment.content;
    }, [comment.content, comment.mentions, onMentionPress]);

    const handleUserPress = useCallback(
      () => onUserPress(comment.user.id),
      [comment.user.id, onUserPress],
    );

    const confirmDelete = useCallback(() => {
      Alert.alert("Delete comment?", "This can’t be undone.", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => onDelete(comment.id),
        },
      ]);
    }, [comment.id, onDelete]);

    // Moderation lives behind the ellipsis and a long press, so the row only
    // shows what people do most: read and reply. Kept as plain data so a
    // native context menu (Expo UI) can render the same list later.
    const options = useMemo<CommentOption[]>(() => {
      const list: CommentOption[] = [];
      if (!isReply) {
        list.push({ label: "Reply", run: () => onReply(comment) });
      }
      list.push({
        label: "View profile",
        optional: true,
        run: handleUserPress,
      });
      if (isOwnComment) {
        list.push({
          label: "Delete comment",
          destructive: true,
          run: confirmDelete,
        });
      } else {
        list.push({ label: "Report comment", run: () => onReport(comment.id) });
        list.push({
          label: `Block ${comment.user.name}`,
          destructive: true,
          run: () => onBlock(comment.user.id, comment.user.name),
        });
      }
      return list;
    }, [
      comment,
      confirmDelete,
      handleUserPress,
      isOwnComment,
      isReply,
      onBlock,
      onReply,
      onReport,
    ]);

    const showOptions = useCallback(
      () => presentCommentOptions(options),
      [options],
    );

    return (
      <Pressable
        // The row is only a long-press target; leave its name, links, Reply
        // and options buttons individually reachable by screen readers.
        accessible={false}
        onLongPress={showOptions}
        delayLongPress={350}
        style={({ pressed }) => [
          styles.container,
          isReply && styles.replyContainer,
          isHighlighted && styles.highlighted,
          pressed && styles.pressed,
        ]}
      >
        <Avatar
          imageUrl={comment.user.image}
          name={comment.user.name}
          size={isReply ? REPLY_AVATAR_SIZE : COMMENT_AVATAR_SIZE}
          onPress={handleUserPress}
        />

        <View style={styles.content}>
          <View style={styles.header}>
            <Text
              type="subheadline"
              numberOfLines={1}
              accessibilityRole="button"
              onPress={handleUserPress}
              style={styles.userName}
            >
              {comment.user.name}
            </Text>
            {isAuthor ? (
              <View style={styles.authorBadge}>
                <Text type="caption2" style={styles.authorBadgeText}>
                  Author
                </Text>
              </View>
            ) : null}
            <Text type="footnote" style={styles.timeAgo}>
              {timeAgo}
            </Text>
            <Pressable
              accessibilityLabel="Comment options"
              accessibilityRole="button"
              hitSlop={12}
              onPress={showOptions}
              style={({ pressed }) => [
                styles.moreButton,
                pressed && styles.dimmed,
              ]}
            >
              <Ionicons
                name="ellipsis-horizontal"
                size={16}
                style={styles.moreIcon}
              />
            </Pressable>
          </View>

          <Text type="subheadline" style={styles.commentText}>
            {renderedContent}
          </Text>

          {!isReply ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Reply to ${comment.user.name}`}
              hitSlop={10}
              onPress={() => onReply(comment)}
              style={({ pressed }) => [
                styles.replyButton,
                pressed && styles.dimmed,
              ]}
            >
              <Text type="footnote" style={styles.replyText}>
                Reply
              </Text>
            </Pressable>
          ) : null}
        </View>
      </Pressable>
    );
  },
);

interface PendingProps {
  content: string;
  isReply?: boolean;
  user: { name: string; image?: string | null };
}

/** The viewer's comment while it posts, shown in place straight away. */
export const PendingCommentCard = memo(
  ({ content, isReply = false, user }: PendingProps) => (
    <View
      accessible
      accessibilityLabel={`Posting your comment: ${content}`}
      style={[
        styles.container,
        isReply && styles.replyContainer,
        styles.pending,
      ]}
    >
      <Avatar
        imageUrl={user.image}
        name={user.name}
        size={isReply ? REPLY_AVATAR_SIZE : COMMENT_AVATAR_SIZE}
      />
      <View style={styles.content}>
        <View style={styles.header}>
          <Text type="subheadline" style={styles.userName}>
            You
          </Text>
          <Text type="footnote" style={styles.timeAgo}>
            Posting…
          </Text>
        </View>
        <Text type="subheadline" style={styles.commentText}>
          {content}
        </Text>
      </View>
    </View>
  ),
);

const styles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    gap: AVATAR_GAP,
    paddingVertical: 10,
    paddingHorizontal: ROW_INSET,
  },
  replyContainer: {
    // Replies hang off the parent's text column, not its avatar.
    paddingLeft: ROW_INSET + COMMENT_AVATAR_SIZE + AVATAR_GAP,
    paddingTop: 4,
    gap: 10,
  },
  highlighted: {
    // A faint wash of the brand red that reads in light and dark themes.
    backgroundColor: `${theme.colors.primary}12`,
  },
  pressed: {
    backgroundColor: theme.colors.pressHighlight,
  },
  pending: {
    opacity: 0.55,
  },
  content: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  userName: {
    flexShrink: 1,
    fontFamily: theme.fonts.semiBold,
  },
  authorBadge: {
    paddingHorizontal: 6,
    borderRadius: 6,
    backgroundColor: theme.colors.primarySoft,
  },
  authorBadgeText: {
    color: theme.colors.onPrimarySoft,
    fontFamily: theme.fonts.semiBold,
    lineHeight: 16,
  },
  timeAgo: {
    color: theme.colors.textSecondary,
  },
  moreButton: {
    marginLeft: "auto",
    width: 28,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  moreIcon: {
    color: theme.colors.textSecondary,
  },
  dimmed: {
    opacity: 0.5,
  },
  commentText: {
    lineHeight: 21,
  },
  mentionText: {
    color: theme.colors.primary,
    fontFamily: theme.fonts.semiBold,
  },
  replyButton: {
    alignSelf: "flex-start",
    marginTop: 4,
  },
  replyText: {
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.semiBold,
  },
}));
