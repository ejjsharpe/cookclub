import { parseMentionTokens } from "@repo/shared";
import { memo, useCallback, useMemo, type ReactNode } from "react";
import { Alert, Pressable, View, useWindowDimensions } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Avatar } from "./Avatar";
import { Ionicons } from "./Ionicons";
import { Text } from "./Text";
import {
  CommentContextMenu,
  CommentOptionsMenu,
} from "./comment-options/CommentOptionsMenu";
import type { CommentOption } from "./comment-options/types";

import type { Comment } from "@/api/comment";
import { formatRelativeTimeShort } from "@/utils/relativeTime";

export const COMMENT_AVATAR_SIZE = 34;
/** Gap between the lifted preview card and the screen edges. */
const PREVIEW_INSET = 12;
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
    const { width: windowWidth } = useWindowDimensions();
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

    // Moderation lives behind the ellipsis and a long press (iOS), so the row
    // only shows what people do most: read and reply.
    const options = useMemo<CommentOption[]>(() => {
      const list: CommentOption[] = [];
      if (!isReply) {
        list.push({
          key: "reply",
          label: "Reply",
          systemImage: "arrowshape.turn.up.left",
          run: () => onReply(comment),
        });
      }
      list.push({
        key: "profile",
        label: "View profile",
        systemImage: "person.crop.circle",
        run: handleUserPress,
      });
      if (isOwnComment) {
        list.push({
          key: "delete",
          label: "Delete comment",
          systemImage: "trash",
          destructive: true,
          run: confirmDelete,
        });
      } else {
        list.push({
          key: "report",
          label: "Report comment",
          systemImage: "flag",
          run: () => onReport(comment.id),
        });
        list.push({
          key: "block",
          // First name keeps the menu row to one line.
          label: `Block ${comment.user.name.split(" ")[0] || comment.user.name}`,
          systemImage: "hand.raised",
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

    return (
      <CommentContextMenu
        options={options}
        preview={
          // A still copy of the comment on a card, lifted while the menu shows.
          <View
            pointerEvents="none"
            style={[styles.preview, { width: windowWidth - PREVIEW_INSET * 2 }]}
          >
            <Avatar
              imageUrl={comment.user.image}
              name={comment.user.name}
              size={COMMENT_AVATAR_SIZE}
            />
            <View style={styles.content}>
              <View style={styles.header}>
                <Text
                  type="subheadline"
                  numberOfLines={1}
                  style={styles.userName}
                >
                  {comment.user.name}
                </Text>
                <Text type="footnote" style={styles.timeAgo}>
                  {timeAgo}
                </Text>
              </View>
              <Text
                type="subheadline"
                numberOfLines={8}
                style={styles.commentText}
              >
                {renderedContent}
              </Text>
            </View>
          </View>
        }
      >
        <View
          style={[
            styles.container,
            isReply && styles.replyContainer,
            isHighlighted && styles.highlighted,
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
              <View style={styles.moreSlot}>
                <CommentOptionsMenu options={options}>
                  <View
                    accessible
                    accessibilityLabel="Comment options"
                    accessibilityRole="button"
                    style={styles.moreButton}
                  >
                    <Ionicons
                      name="ellipsis-horizontal"
                      size={16}
                      style={styles.moreIcon}
                    />
                  </View>
                </CommentOptionsMenu>
              </View>
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
        </View>
      </CommentContextMenu>
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
  preview: {
    flexDirection: "row",
    gap: AVATAR_GAP,
    padding: 16,
    borderRadius: 22,
    borderCurve: "continuous",
    backgroundColor: theme.colors.background,
  },
  highlighted: {
    // A faint wash of the brand red that reads in light and dark themes.
    backgroundColor: `${theme.colors.primary}12`,
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
  moreSlot: {
    marginLeft: "auto",
  },
  moreButton: {
    // Taller than the icon so the menu is easy to hit.
    width: 32,
    height: 28,
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
