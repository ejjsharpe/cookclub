import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { findActiveMention, replaceActiveMention } from "@repo/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Pressable,
  ScrollView,
  View,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
  type TextInputInstance,
  type TextInputSelectionChangeEvent,
} from "react-native";
import {
  KeyboardAvoidingView,
  useKeyboardHandler,
  useReanimatedKeyboardAnimation,
} from "react-native-keyboard-controller";
import Animated, {
  FadeIn,
  FadeOut,
  ZoomIn,
  ZoomOut,
  interpolate,
  scrollTo,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import {
  StyleSheet,
  UnistylesRuntime,
  useUnistyles,
} from "react-native-unistyles";
import { scheduleOnRN } from "react-native-worklets";

import { useActivity } from "@/api/activity";
import {
  useCommentMentionSuggestions,
  useComments,
  useCreateComment,
  useDeleteComment,
  type Comment,
} from "@/api/comment";
import { useBlockUser } from "@/api/moderation";
import { useUser } from "@/api/user";
import { ActivityPostOptionsButton } from "@/components/ActivityPostOptionsButton";
import { Avatar } from "@/components/Avatar";
import { CommentCard, PendingCommentCard } from "@/components/CommentCard";
import { Ionicons } from "@/components/Ionicons";
import { MentionTextInput } from "@/components/MentionTextInput";
import { OptimizedImage } from "@/components/OptimizedImage";
import {
  ReportContentSheet,
  type ReportContentSheetRef,
} from "@/components/ReportContentSheet";
import { Text } from "@/components/Text";
import { FeedOpenIndicator } from "@/components/feed/FeedCardParts";
import { GLASS_CONTROL_SIZE, GlassSurface } from "@/components/glass/Glass";
import { useDebounce } from "@/hooks/useDebounce";
import { alertApiError } from "@/lib/apiErrorAlert";
import { openExternalWebsite } from "@/lib/externalBrowser";
import { useSessionContext } from "@/lib/sessionContext";
import type { RootStackParamList } from "@/navigation/navigationRef";
import { formatRelativeTimeShort } from "@/utils/relativeTime";

const MAX_SCROLL_RETRIES = 2;
const SCROLL_RETRY_DELAY_MS = 150;
const NAV_BAR_HEIGHT = 60;
const MAX_MENTION_SUGGESTIONS = 10;
const MENTION_SEARCH_DEBOUNCE_MS = 300;
const MAX_COMMENT_LENGTH = 500;
/** The character count appears once a comment gets long. */
const COMMENT_COUNTER_THRESHOLD = 250;
const COMPOSER_MIN_HEIGHT = 48;
const SEND_BUTTON_SIZE = 36;
const QUICK_REPLIES = ["Looks delicious", "Saving this", "Any swaps?"];

type ActivityScreenRoute = RouteProp<RootStackParamList, "Activity">;
type ActivityScreenNavigation = NativeStackNavigationProp<
  RootStackParamList,
  "Activity"
>;
type Activity = NonNullable<ReturnType<typeof useActivity>["data"]>;

type CommentListItem =
  | { kind: "comment"; comment: Comment; isReply: boolean }
  | { kind: "pending"; content: string; isReply: boolean };

const ReanimatedFlatList = Animated.createAnimatedComponent(
  FlatList<CommentListItem>,
);

const getActivityAction = (activity: Activity) => {
  if (activity.type === "cooking_review") return "cooked this";
  if (activity.recipe.sourceType === "manual") return "wrote this";
  if (activity.recipe.sourceType === "ai") return "made this with AI";
  return "saved this";
};

const getActivityThumbnail = (activity: Activity) =>
  (activity.type === "cooking_review"
    ? activity.review.images[0]
    : undefined) ?? activity.recipe.image;

export const ActivityScreen = () => {
  const navigation = useNavigation<ActivityScreenNavigation>();
  const route = useRoute<ActivityScreenRoute>();
  const activityEventId =
    Number.isInteger(route.params.activityEventId) &&
    route.params.activityEventId > 0
      ? route.params.activityEventId
      : 0;
  const focusedCommentId =
    Number.isInteger(route.params.commentId) &&
    (route.params.commentId ?? 0) > 0
      ? route.params.commentId
      : undefined;
  const shouldFocusCommentInput = route.params.focusCommentInput === true;
  const { theme } = useUnistyles();
  const insets = UnistylesRuntime.insets;
  const { progress: keyboardProgress } = useReanimatedKeyboardAnimation();
  const listRef = useAnimatedRef<FlatList<CommentListItem>>();
  const inputRef = useRef<TextInputInstance>(null);
  const reportSheetRef = useRef<ReportContentSheetRef>(null);
  const scrollRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const scrollRetryCountRef = useRef(0);
  const completedFocusRef = useRef<number | null>(null);
  const hasFinishedEntryTransitionRef = useRef(false);
  const completedCommentFocusRef = useRef<number | null>(null);
  const isSubmittingRef = useRef(false);
  const listScrollOffset = useSharedValue(0);
  const listScrollBase = useSharedValue(0);
  const listKeyboardOffset = useSharedValue(0);
  // Once the post row scrolls under the nav bar, the title becomes a glass
  // pill for the recipe so the conversation never loses its context.
  const pillThreshold = useSharedValue(Number.POSITIVE_INFINITY);
  const showPostPillSV = useSharedValue(false);
  const titleOpacity = useSharedValue(1);

  const [showPostPill, setShowPostPill] = useState(false);
  const [composerHeight, setComposerHeight] = useState(COMPOSER_MIN_HEIGHT);
  const [commentText, setCommentText] = useState("");
  const [commentSelection, setCommentSelection] = useState({
    start: 0,
    end: 0,
  });
  const [taggedUsernames, setTaggedUsernames] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [replyingTo, setReplyingTo] = useState<Comment | null>(null);
  const activeMention = useMemo(
    () => findActiveMention(commentText, commentSelection),
    [commentSelection, commentText],
  );
  const mentionQuery = activeMention?.query ?? "";
  const debouncedMentionQuery = useDebounce(
    mentionQuery,
    MENTION_SEARCH_DEBOUNCE_MS,
  );
  const {
    data: mentionSuggestionData,
    isFetching: areMentionSuggestionsFetching,
    isError: areMentionSuggestionsError,
  } = useCommentMentionSuggestions(
    debouncedMentionQuery,
    MAX_MENTION_SUGGESTIONS,
    activeMention !== null,
  );
  const mentionSuggestions = useMemo(
    () =>
      (mentionSuggestionData ?? []).flatMap((suggestion) =>
        suggestion.username
          ? [{ ...suggestion, username: suggestion.username }]
          : [],
      ),
    [mentionSuggestionData],
  );
  const areMentionSuggestionsLoading =
    debouncedMentionQuery !== mentionQuery || areMentionSuggestionsFetching;
  const showMentionSelector =
    activeMention !== null &&
    (areMentionSuggestionsLoading ||
      areMentionSuggestionsError ||
      mentionSuggestions.length > 0);

  // The composer floats over the list: lift it off the home indicator, and
  // tuck it down onto the keyboard when that's up.
  const composerAnimatedStyle = useAnimatedStyle(() => ({
    paddingBottom: interpolate(
      keyboardProgress.get(),
      [0, 1],
      [Math.max(insets.bottom, 12), 8],
    ),
  }));

  // Height avoidance shrinks the list but does not preserve its lower visible
  // edge. Compensate the scroll offset so the same content moves upward.
  const syncListWithKeyboard = useCallback(
    (keyboardHeight: number, keyboardAnimationProgress: number) => {
      "worklet";

      const keyboardOffset = Math.max(
        0,
        keyboardHeight - insets.bottom * keyboardAnimationProgress,
      );
      listKeyboardOffset.set(keyboardOffset);
      scrollTo(
        listRef,
        0,
        Math.max(0, listScrollBase.get() + keyboardOffset),
        false,
      );
    },
    [insets.bottom],
  );

  useKeyboardHandler(
    {
      onStart: () => {
        "worklet";
        listScrollBase.set(listScrollOffset.get() - listKeyboardOffset.get());
      },
      onMove: (event) => {
        "worklet";
        syncListWithKeyboard(event.height, event.progress);
      },
      onInteractive: (event) => {
        "worklet";
        syncListWithKeyboard(event.height, event.progress);
      },
      onEnd: (event) => {
        "worklet";
        syncListWithKeyboard(event.height, event.progress);
      },
    },
    [syncListWithKeyboard],
  );

  const handleScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      listScrollOffset.set(event.contentOffset.y);
      const nextShowPill = event.contentOffset.y > pillThreshold.get();
      if (showPostPillSV.get() !== nextShowPill) {
        showPostPillSV.set(nextShowPill);
        titleOpacity.set(withTiming(nextShowPill ? 0 : 1, { duration: 150 }));
        scheduleOnRN(setShowPostPill, nextShowPill);
      }
    },
  });

  const titleAnimatedStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.get(),
  }));

  const {
    data: activity,
    isLoading: isActivityLoading,
    isError: isActivityError,
    isFetching: isActivityFetching,
    refetch: refetchActivity,
  } = useActivity(activityEventId);
  const {
    data: commentsData,
    isLoading: areCommentsLoading,
    isError: areCommentsError,
    isFetching: areCommentsFetching,
    refetch: refetchComments,
  } = useComments(activityEventId, focusedCommentId);
  const { data: currentUser } = useUser();
  const session = useSessionContext();
  const currentUserId = currentUser?.user?.id ?? session?.user.id;
  const viewer = {
    name: currentUser?.user?.name ?? session?.user.name ?? "You",
    image: currentUser?.user?.image ?? null,
  };
  const activityActorId = activity?.actor.id;
  const activityActorName = activity?.actor.name;
  const {
    mutateAsync: createComment,
    isPending: isCreatingComment,
    variables: pendingComment,
  } = useCreateComment();
  const { mutateAsync: deleteComment } = useDeleteComment(activityEventId);
  const { mutate: blockUser } = useBlockUser();

  const listItems = useMemo<CommentListItem[]>(() => {
    const items: CommentListItem[] = [];
    const pendingHere =
      isCreatingComment && pendingComment?.activityEventId === activityEventId
        ? pendingComment
        : undefined;
    const pending = pendingHere ? pendingHere.parentCommentId : null;
    for (const comment of commentsData?.comments ?? []) {
      items.push({ kind: "comment", comment, isReply: false });
      for (const reply of comment.replies) {
        items.push({ kind: "comment", comment: reply, isReply: true });
      }
      if (pending === comment.id && pendingHere) {
        items.push({
          kind: "pending",
          content: pendingHere.content,
          isReply: true,
        });
      }
    }
    if (pendingHere && pending === undefined) {
      items.push({
        kind: "pending",
        content: pendingHere.content,
        isReply: false,
      });
    }
    return items;
  }, [
    activityEventId,
    commentsData?.comments,
    isCreatingComment,
    pendingComment,
  ]);

  // Read by the post's failure path, which resolves after later renders.
  const latestComposerRef = useRef({ activityEventId, commentText });
  useEffect(() => {
    latestComposerRef.current = { activityEventId, commentText };
  }, [activityEventId, commentText]);

  const focusedCommentUnavailable =
    focusedCommentId !== undefined &&
    commentsData?.focusedCommentStatus === "unavailable";

  useEffect(() => {
    completedFocusRef.current = null;
    scrollRetryCountRef.current = 0;
  }, [activityEventId, focusedCommentId]);

  useEffect(() => {
    setCommentText("");
    setCommentSelection({ start: 0, end: 0 });
    setTaggedUsernames(new Set());
    setReplyingTo(null);
    Keyboard.dismiss();
  }, [activityEventId]);

  useEffect(() => {
    hasFinishedEntryTransitionRef.current = false;
    if (!shouldFocusCommentInput) return;

    return navigation.addListener("transitionEnd", (event) => {
      if (event.data.closing) return;

      hasFinishedEntryTransitionRef.current = true;
      if (completedCommentFocusRef.current === activityEventId) return;

      const input = inputRef.current;
      if (!input) return;

      input.focus();
      completedCommentFocusRef.current = activityEventId;
    });
  }, [activityEventId, navigation, shouldFocusCommentInput]);

  useEffect(() => {
    if (
      !shouldFocusCommentInput ||
      !activity ||
      areCommentsError ||
      !hasFinishedEntryTransitionRef.current ||
      completedCommentFocusRef.current === activityEventId
    ) {
      return;
    }

    const input = inputRef.current;
    if (!input) return;

    input.focus();
    completedCommentFocusRef.current = activityEventId;
  }, [activity, activityEventId, areCommentsError, shouldFocusCommentInput]);

  useEffect(() => {
    if (
      !activity ||
      focusedCommentId === undefined ||
      commentsData?.focusedCommentStatus !== "found" ||
      completedFocusRef.current === focusedCommentId
    ) {
      return;
    }

    const targetIndex = listItems.findIndex(
      (item) => item.kind === "comment" && item.comment.id === focusedCommentId,
    );
    if (targetIndex < 0) return;

    scrollRetryCountRef.current = 0;
    scrollRetryTimeoutRef.current = setTimeout(() => {
      completedFocusRef.current = focusedCommentId;
      listRef.current?.scrollToIndex({
        index: targetIndex,
        animated: true,
        viewPosition: 0.2,
      });
    }, SCROLL_RETRY_DELAY_MS);

    return () => {
      if (scrollRetryTimeoutRef.current) {
        clearTimeout(scrollRetryTimeoutRef.current);
        scrollRetryTimeoutRef.current = null;
      }
    };
  }, [
    activity,
    commentsData?.focusedCommentStatus,
    listItems,
    focusedCommentId,
  ]);

  useEffect(
    () => () => {
      if (scrollRetryTimeoutRef.current) {
        clearTimeout(scrollRetryTimeoutRef.current);
      }
    },
    [],
  );

  const handleScrollToIndexFailed = useCallback(
    ({
      index,
      averageItemLength,
    }: {
      index: number;
      averageItemLength: number;
    }) => {
      if (scrollRetryCountRef.current >= MAX_SCROLL_RETRIES) return;

      scrollRetryCountRef.current += 1;
      listRef.current?.scrollToOffset({
        offset: Math.max(0, index * averageItemLength),
        animated: false,
      });

      if (scrollRetryTimeoutRef.current) {
        clearTimeout(scrollRetryTimeoutRef.current);
      }
      scrollRetryTimeoutRef.current = setTimeout(() => {
        listRef.current?.scrollToIndex({
          index,
          animated: true,
          viewPosition: 0.2,
        });
      }, SCROLL_RETRY_DELAY_MS);
    },
    [],
  );

  const handlePostRowLayout = useCallback((event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    // Layout is relative to the list header, which already sits below the
    // nav bar's padding, so the row is fully tucked under the nav bar once
    // the list has scrolled past its bottom edge.
    pillThreshold.set(y + height - 8);
  }, []);

  const handleComposerLayout = useCallback((event: LayoutChangeEvent) => {
    setComposerHeight(event.nativeEvent.layout.height);
  }, []);

  const handleBackPress = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }

    navigation.navigate("Tabs");
  }, [navigation]);

  const handleUserPress = useCallback(
    (userId: string) => {
      navigation.navigate("UserProfile", { userId });
    },
    [navigation],
  );

  const handleOpenRecipe = useCallback(() => {
    if (!activity) return;
    if (activity.recipe.sourceType === "url") {
      openExternalWebsite(activity.recipe.sourceUrl).catch(() => {});
      return;
    }
    navigation.navigate("RecipeDetail", { recipeId: activity.recipe.id });
  }, [activity, navigation]);

  const handleReportActivity = useCallback(() => {
    reportSheetRef.current?.present({
      targetType: "activity",
      targetId: String(activityEventId),
    });
  }, [activityEventId]);

  const handleReportComment = useCallback((targetCommentId: number) => {
    reportSheetRef.current?.present({
      targetType: "comment",
      targetId: String(targetCommentId),
    });
  }, []);

  const handleBlock = useCallback(
    (userId: string, name: string) => {
      Alert.alert(
        `Block ${name}?`,
        "You will no longer see each other's profiles or content. Previous follows will be removed.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Block",
            style: "destructive",
            onPress: () =>
              blockUser(
                { userId },
                {
                  onSuccess: () =>
                    setReplyingTo((target) =>
                      target?.user.id === userId ? null : target,
                    ),
                  onError: (error) =>
                    alertApiError("Block Failed", error, {
                      operation: "moderation.blockUser",
                      fallback: "Could not block this user. Please try again.",
                    }),
                },
              ),
          },
        ],
      );
    },
    [blockUser],
  );

  const handleBlockActivityAuthor = useCallback(
    (userId: string) => {
      if (activityActorName) {
        handleBlock(userId, activityActorName);
      }
    },
    [activityActorName, handleBlock],
  );

  const handleReply = useCallback((comment: Comment) => {
    setReplyingTo(comment);
    inputRef.current?.focus();
  }, []);

  const handleQuickReply = useCallback((text: string) => {
    setCommentText(text);
    setCommentSelection({ start: text.length, end: text.length });
    inputRef.current?.focus();
  }, []);

  const handleCommentSelectionChange = useCallback(
    (event: TextInputSelectionChangeEvent) => {
      setCommentSelection(event.nativeEvent.selection);
    },
    [],
  );

  const handleMentionSelect = useCallback(
    (username: string) => {
      if (!activeMention) return;

      const replacement = replaceActiveMention(
        commentText,
        activeMention,
        username,
      );
      setCommentText(replacement.content);
      setCommentSelection({
        start: replacement.cursor,
        end: replacement.cursor,
      });
      setTaggedUsernames((currentUsernames) => {
        if (currentUsernames.has(username)) return currentUsernames;

        const nextUsernames = new Set(currentUsernames);
        nextUsernames.add(username);
        return nextUsernames;
      });
      inputRef.current?.focus();
    },
    [activeMention, commentText],
  );

  const handleDelete = useCallback(
    async (targetCommentId: number) => {
      try {
        await deleteComment({
          commentId: targetCommentId,
        });
        setReplyingTo((target) =>
          target?.id === targetCommentId ? null : target,
        );
      } catch (error) {
        alertApiError("Couldn’t Delete Comment", error, {
          operation: "comment.delete",
          fallback: "Failed to delete comment. Please try again.",
        });
      }
    },
    [deleteComment],
  );

  const handleSubmit = useCallback(async () => {
    const content = commentText.trim();
    if (!content || isCreatingComment || isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    // Clear straight away: the comment shows in the list as "Posting…"
    // until it's saved, and comes back to the composer if it fails.
    const draft = { commentText, taggedUsernames, replyingTo };
    setCommentText("");
    setCommentSelection({ start: 0, end: 0 });
    setTaggedUsernames(new Set());
    setReplyingTo(null);

    if (!replyingTo) {
      // Scroll to the new comment once the keyboard has gone: the keyboard
      // sync pins the scroll offset while it animates away.
      const scrollToLatest = () =>
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
      if (Keyboard.isVisible()) {
        const subscription = Keyboard.addListener("keyboardDidHide", () => {
          subscription.remove();
          scrollToLatest();
        });
      } else {
        scrollToLatest();
      }
    }
    Keyboard.dismiss();

    try {
      await createComment({
        activityEventId,
        parentCommentId: replyingTo?.id,
        content,
      });
    } catch (error) {
      // Only bring the draft back if it wouldn't overwrite something newer.
      const latest = latestComposerRef.current;
      if (
        latest.activityEventId === activityEventId &&
        latest.commentText.length === 0
      ) {
        setCommentText(draft.commentText);
        setCommentSelection({
          start: draft.commentText.length,
          end: draft.commentText.length,
        });
        setTaggedUsernames(draft.taggedUsernames);
        setReplyingTo(draft.replyingTo);
      }
      alertApiError("Couldn’t Post Comment", error, {
        operation: "comment.create",
        fallback: "Failed to post comment. Please try again.",
      });
    } finally {
      isSubmittingRef.current = false;
    }
  }, [
    activityEventId,
    commentText,
    createComment,
    isCreatingComment,
    replyingTo,
    taggedUsernames,
  ]);

  const renderComment = useCallback(
    ({ item }: ListRenderItemInfo<CommentListItem>) =>
      item.kind === "pending" ? (
        <PendingCommentCard
          content={item.content}
          isReply={item.isReply}
          user={viewer}
        />
      ) : (
        <CommentCard
          comment={item.comment}
          isReply={item.isReply}
          isHighlighted={
            item.comment.id === focusedCommentId ||
            item.comment.id === replyingTo?.id
          }
          isOwnComment={item.comment.user.id === currentUserId}
          isAuthor={item.comment.user.id === activityActorId}
          onReply={handleReply}
          onDelete={handleDelete}
          onReport={handleReportComment}
          onBlock={handleBlock}
          onUserPress={handleUserPress}
          onMentionPress={handleUserPress}
        />
      ),
    [
      activityActorId,
      currentUserId,
      focusedCommentId,
      handleBlock,
      handleDelete,
      handleReply,
      handleReportComment,
      handleUserPress,
      replyingTo?.id,
      viewer,
    ],
  );

  const keyExtractor = useCallback(
    (item: CommentListItem) =>
      item.kind === "pending" ? "pending" : item.comment.id.toString(),
    [],
  );

  const handleRetry = useCallback(() => {
    refetchActivity();
    refetchComments();
  }, [refetchActivity, refetchComments]);

  const backButton = (
    <GlassSurface interactive style={styles.glassCircle}>
      <Pressable
        accessibilityLabel="Go back"
        accessibilityRole="button"
        hitSlop={4}
        onPress={handleBackPress}
        style={({ pressed }) => [
          styles.glassCircleHit,
          pressed && styles.dimmed,
        ]}
      >
        <Ionicons name="chevron-back" size={24} style={styles.navIcon} />
      </Pressable>
    </GlassSurface>
  );

  if (isActivityLoading || isActivityError || !activity) {
    return (
      <View style={styles.screen}>
        <View style={styles.centeredState}>
          {isActivityLoading ? (
            <ActivityIndicator size="large" color={theme.colors.primary} />
          ) : (
            <>
              <Ionicons
                name="document-outline"
                size={44}
                style={styles.stateIcon}
              />
              <Text type="title3">Post unavailable</Text>
              <Text type="body" style={styles.stateMessage}>
                This post may have been removed or is no longer available.
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={isActivityFetching}
                onPress={handleRetry}
                style={({ pressed }) => [
                  styles.retryButton,
                  pressed && styles.dimmed,
                ]}
              >
                {isActivityFetching ? (
                  <ActivityIndicator color={theme.colors.buttonText} />
                ) : (
                  <Text type="headline" style={styles.retryButtonText}>
                    Try again
                  </Text>
                )}
              </Pressable>
            </>
          )}
        </View>
        <View style={styles.navBar}>
          {backButton}
          <View style={styles.navCenter}>
            <View style={styles.navTitleWrap}>
              <Text type="headline" style={styles.navTitle}>
                Comments
              </Text>
            </View>
          </View>
          <View style={styles.navSpacer} />
        </View>
      </View>
    );
  }

  const isOwnPost = activity.actor.id === currentUserId;
  const thumbnail = getActivityThumbnail(activity);
  const isExternalRecipe = activity.recipe.sourceType === "url";
  const commentCountLabel = `${activity.commentCount} ${
    activity.commentCount === 1 ? "comment" : "comments"
  }`;
  const reviewText =
    activity.type === "cooking_review" ? activity.review.text : null;
  const authorFirstName = activity.actor.name.split(" ")[0] || "them";

  const postRow = (
    <Pressable
      accessibilityRole={isExternalRecipe ? "link" : "button"}
      accessibilityLabel={`${activity.recipe.name}, ${activity.actor.name} ${getActivityAction(activity)}. Opens the recipe.`}
      onLayout={handlePostRowLayout}
      onPress={handleOpenRecipe}
      style={({ pressed }) => [
        styles.postRow,
        pressed && styles.postRowPressed,
      ]}
    >
      <View style={styles.postRowMain}>
        {thumbnail ? (
          <OptimizedImage
            image={thumbnail}
            preset="thumb_200"
            style={styles.postThumb}
            priority="high"
            decodeFormat="rgb"
            transition={0}
          />
        ) : (
          <View style={[styles.postThumb, styles.postThumbEmpty]}>
            <Ionicons
              name="restaurant-outline"
              size={22}
              style={styles.stateIcon}
            />
          </View>
        )}
        <View style={styles.postText}>
          <Text type="callout" numberOfLines={2} style={styles.postTitle}>
            {activity.recipe.name}
          </Text>
          <Text type="footnote" numberOfLines={1} style={styles.secondary}>
            {activity.actor.name} {getActivityAction(activity)} ·{" "}
            {formatRelativeTimeShort(activity.createdAt)}
          </Text>
        </View>
        <FeedOpenIndicator external={isExternalRecipe} />
      </View>
      {reviewText ? (
        <Text type="subheadline" numberOfLines={3} style={styles.reviewText}>
          “{reviewText}”
        </Text>
      ) : null}
    </Pressable>
  );

  const listHeader = (
    <>
      {postRow}
      <Text type="subheadline" style={styles.sectionLabel}>
        {commentCountLabel}
      </Text>
      {focusedCommentUnavailable ? (
        <View style={styles.notice}>
          <Ionicons
            name="information-circle-outline"
            size={20}
            style={styles.noticeIcon}
          />
          <Text type="subheadline" style={styles.noticeText}>
            This comment is no longer available.
          </Text>
        </View>
      ) : null}
      {areCommentsError ? (
        <View style={styles.commentsError}>
          <Text type="headline">Comments unavailable</Text>
          <Text type="subheadline" style={styles.stateMessage}>
            We couldn’t load the comments for this post.
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={areCommentsFetching}
            onPress={() => refetchComments()}
            style={styles.inlineRetryButton}
          >
            <Text type="headline" style={styles.inlineRetryText}>
              {areCommentsFetching ? "Trying again…" : "Try again"}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {areCommentsLoading ? (
        <ActivityIndicator style={styles.commentsLoader} />
      ) : null}
    </>
  );

  const emptyState =
    !areCommentsLoading && !areCommentsError && !focusedCommentUnavailable ? (
      <View style={styles.emptyState}>
        <View style={styles.emptyIcon}>
          <Ionicons
            name="chatbubble-outline"
            size={28}
            style={styles.emptyIconGlyph}
          />
        </View>
        <Text type="title3">No comments yet</Text>
        <Text type="subheadline" style={styles.stateMessage}>
          {isOwnPost
            ? "When people comment on your post, you’ll see it here."
            : `Tried it, tweaked it, or have a question? Tell ${authorFirstName}.`}
        </Text>
        {!isOwnPost ? (
          <View style={styles.quickReplies}>
            {QUICK_REPLIES.map((reply) => (
              <Pressable
                key={reply}
                accessibilityRole="button"
                accessibilityHint="Adds this to your comment"
                onPress={() => handleQuickReply(reply)}
                style={({ pressed }) => [
                  styles.quickReply,
                  pressed && styles.dimmed,
                ]}
              >
                <Text type="subheadline" style={styles.quickReplyText}>
                  {reply}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    ) : undefined;

  const mentionSelector = showMentionSelector ? (
    <Animated.View
      entering={FadeIn.duration(150)}
      exiting={FadeOut.duration(120)}
    >
      <GlassSurface style={styles.mentionCard}>
        <ScrollView
          accessibilityLabel="People to tag"
          keyboardShouldPersistTaps="always"
          style={styles.mentionScroll}
          contentContainerStyle={styles.mentionScrollContent}
        >
          {mentionSuggestions.map((suggestion) => (
            <Pressable
              key={suggestion.id}
              accessibilityLabel={`Tag ${suggestion.name}, @${suggestion.username}`}
              accessibilityRole="button"
              onPress={() => handleMentionSelect(suggestion.username)}
              style={({ pressed }) => [
                styles.mentionSuggestion,
                pressed && styles.mentionSuggestionPressed,
              ]}
            >
              <Avatar
                imageUrl={suggestion.image}
                name={suggestion.name}
                size={34}
                subscriptionTier={suggestion.subscriptionTier}
              />
              <View style={styles.mentionSuggestionText}>
                <Text type="subheadline" numberOfLines={1} style={styles.bold}>
                  {suggestion.name}
                </Text>
                <Text
                  type="footnote"
                  numberOfLines={1}
                  style={styles.secondary}
                >
                  @{suggestion.username}
                </Text>
              </View>
            </Pressable>
          ))}
          {areMentionSuggestionsLoading ? (
            <View
              accessibilityLiveRegion="polite"
              style={styles.mentionSuggestion}
            >
              <View style={styles.mentionLoadingAvatar}>
                <ActivityIndicator size="small" />
              </View>
              <Text type="footnote" style={styles.secondary}>
                {mentionQuery
                  ? `Searching for “${mentionQuery}”`
                  : "Searching for people"}
              </Text>
            </View>
          ) : areMentionSuggestionsError ? (
            <View style={styles.mentionSuggestion}>
              <Text type="footnote" style={styles.secondary}>
                Couldn’t load tag suggestions.
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </GlassSurface>
    </Animated.View>
  ) : null;

  // Space the composer leaves below itself when the keyboard is down.
  const composerRestingInset = Math.max(insets.bottom, 12);
  const trimmedLength = commentText.trim().length;
  const canSubmit = trimmedLength > 0 && !isCreatingComment;
  const showCounter = commentText.length >= COMMENT_COUNTER_THRESHOLD;

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.keyboardArea}
        behavior="height"
        keyboardVerticalOffset={0}
      >
        <ReanimatedFlatList
          ref={listRef}
          data={areCommentsError ? [] : listItems}
          renderItem={renderComment}
          keyExtractor={keyExtractor}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={emptyState}
          contentContainerStyle={[
            styles.listContent,
            {
              paddingTop: insets.top + NAV_BAR_HEIGHT,
              paddingBottom: composerHeight + composerRestingInset + 16,
            },
          ]}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          onScroll={handleScroll}
          onScrollToIndexFailed={handleScrollToIndexFailed}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
        />

        {/* Soft scroll edges so content dissolves under the floating glass. */}
        <View
          pointerEvents="none"
          style={[
            styles.bottomEdge,
            { height: composerHeight + composerRestingInset + 24 },
          ]}
        />

        {!areCommentsError ? (
          <Animated.View
            pointerEvents="box-none"
            style={[styles.composerArea, composerAnimatedStyle]}
          >
            {mentionSelector}
            <View
              onLayout={handleComposerLayout}
              pointerEvents="box-none"
              style={styles.composerStack}
            >
              {replyingTo ? (
                <Animated.View
                  entering={FadeIn.duration(150)}
                  exiting={FadeOut.duration(120)}
                  style={styles.replyChipWrap}
                >
                  <GlassSurface style={styles.replyChip}>
                    <View style={styles.replyChipContent}>
                      <Ionicons
                        name="arrow-undo-outline"
                        size={14}
                        style={styles.replyChipIcon}
                      />
                      <Text
                        type="footnote"
                        numberOfLines={1}
                        style={styles.replyChipText}
                      >
                        Replying to{" "}
                        <Text type="footnote" style={styles.bold}>
                          {replyingTo.user.name.split(" ")[0]}
                        </Text>
                      </Text>
                      <Pressable
                        accessibilityLabel="Cancel reply"
                        accessibilityRole="button"
                        hitSlop={10}
                        onPress={() => setReplyingTo(null)}
                        style={styles.replyChipClose}
                      >
                        <Ionicons
                          name="close"
                          size={13}
                          style={styles.replyChipIcon}
                        />
                      </Pressable>
                    </View>
                  </GlassSurface>
                </Animated.View>
              ) : null}
              <GlassSurface
                style={styles.composer}
                contentStyle={styles.composerContent}
              >
                {commentText.length === 0 ? (
                  <View style={styles.composerAvatar}>
                    <Avatar
                      imageUrl={viewer.image}
                      name={viewer.name}
                      size={34}
                    />
                  </View>
                ) : null}
                <MentionTextInput
                  ref={inputRef}
                  accessibilityLabel={replyingTo ? "Reply" : "Comment"}
                  value={commentText}
                  taggedUsernames={taggedUsernames}
                  onChangeText={setCommentText}
                  selection={commentSelection}
                  onSelectionChange={handleCommentSelectionChange}
                  placeholder={
                    replyingTo
                      ? `Reply to ${replyingTo.user.name.split(" ")[0]}…`
                      : listItems.length === 0 && !areCommentsLoading
                        ? "Be the first to comment…"
                        : "Add a comment…"
                  }
                  placeholderTextColor={theme.colors.placeholderText}
                  cursorColor={theme.colors.primary}
                  selectionColor={theme.colors.primary}
                  multiline
                  maxLength={MAX_COMMENT_LENGTH}
                  containerStyle={styles.composerInput}
                />
                {showCounter ? (
                  <Text
                    type="footnote"
                    accessibilityLabel={`${commentText.length} of ${MAX_COMMENT_LENGTH} characters`}
                    style={styles.counter}
                  >
                    {commentText.length} / {MAX_COMMENT_LENGTH}
                  </Text>
                ) : null}
                {canSubmit ? (
                  <Animated.View
                    entering={ZoomIn.duration(160)}
                    exiting={ZoomOut.duration(120)}
                  >
                    <Pressable
                      accessibilityLabel={
                        replyingTo ? "Post reply" : "Post comment"
                      }
                      accessibilityRole="button"
                      onPress={handleSubmit}
                      style={({ pressed }) => [
                        styles.sendButton,
                        pressed && styles.sendButtonPressed,
                      ]}
                    >
                      <Ionicons
                        name="arrow-up"
                        size={20}
                        style={styles.sendIcon}
                      />
                    </Pressable>
                  </Animated.View>
                ) : null}
              </GlassSurface>
            </View>
          </Animated.View>
        ) : null}
      </KeyboardAvoidingView>

      <View pointerEvents="none" style={styles.topEdge} />
      <View style={styles.navBar}>
        {backButton}
        <View style={styles.navCenter}>
          <Animated.View
            pointerEvents="none"
            accessibilityElementsHidden={showPostPill}
            importantForAccessibility={
              showPostPill ? "no-hide-descendants" : "auto"
            }
            style={[styles.navTitleWrap, titleAnimatedStyle]}
          >
            <Text type="headline" style={styles.navTitle}>
              Comments
            </Text>
          </Animated.View>
          <View
            accessibilityElementsHidden={!showPostPill}
            importantForAccessibility={
              showPostPill ? "auto" : "no-hide-descendants"
            }
          >
            <GlassSurface
              interactive
              hidden={!showPostPill}
              style={styles.postPill}
            >
              <Pressable
                accessibilityRole={isExternalRecipe ? "link" : "button"}
                accessibilityLabel={`${activity.recipe.name}, ${commentCountLabel}. Opens the recipe.`}
                onPress={handleOpenRecipe}
                style={({ pressed }) => [
                  styles.postPillContent,
                  pressed && styles.dimmed,
                ]}
              >
                {thumbnail ? (
                  <OptimizedImage
                    image={thumbnail}
                    preset="thumb_200"
                    style={styles.postPillThumb}
                    decodeFormat="rgb"
                    transition={0}
                  />
                ) : (
                  <View style={[styles.postPillThumb, styles.postThumbEmpty]} />
                )}
                <View style={styles.postPillText}>
                  <Text
                    type="subheadline"
                    numberOfLines={1}
                    style={styles.bold}
                  >
                    {activity.recipe.name}
                  </Text>
                  <Text type="caption1" numberOfLines={1}>
                    {commentCountLabel}
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={14}
                  style={styles.secondaryIcon}
                />
              </Pressable>
            </GlassSurface>
          </View>
        </View>
        {isOwnPost ? (
          <View style={styles.navSpacer} />
        ) : (
          <GlassSurface interactive style={styles.glassCircle}>
            <View style={styles.glassCircleHit}>
              <ActivityPostOptionsButton
                activityId={activityEventId}
                onReportPress={handleReportActivity}
                blockUserId={activity.actor.id}
                onBlockPress={handleBlockActivityAuthor}
              />
            </View>
          </GlassSurface>
        )}
      </View>
      <ReportContentSheet ref={reportSheetRef} />
    </View>
  );
};

const styles = StyleSheet.create((theme, rt) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  keyboardArea: {
    flex: 1,
  },
  // ── Nav bar ────────────────────────────────────────────────────────────
  navBar: {
    position: "absolute",
    top: rt.insets.top,
    left: rt.insets.left,
    right: rt.insets.right,
    height: NAV_BAR_HEIGHT,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  topEdge: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: rt.insets.top + NAV_BAR_HEIGHT + 12,
    backgroundImage: `linear-gradient(${theme.colors.background} 55%, ${theme.colors.background}00)`,
  },
  bottomEdge: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundImage: `linear-gradient(${theme.colors.background}00, ${theme.colors.background}B3)`,
  },
  glassCircle: {
    width: GLASS_CONTROL_SIZE,
    height: GLASS_CONTROL_SIZE,
    borderRadius: GLASS_CONTROL_SIZE / 2,
  },
  glassCircleHit: {
    width: GLASS_CONTROL_SIZE,
    height: GLASS_CONTROL_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  navIcon: {
    color: theme.colors.text,
  },
  navCenter: {
    flex: 1,
    height: GLASS_CONTROL_SIZE,
    justifyContent: "center",
  },
  navTitleWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  navTitle: {
    textAlign: "center",
  },
  navSpacer: {
    width: GLASS_CONTROL_SIZE,
  },
  postPill: {
    height: GLASS_CONTROL_SIZE,
    borderRadius: GLASS_CONTROL_SIZE / 2,
  },
  postPillContent: {
    height: GLASS_CONTROL_SIZE,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 5,
    paddingRight: 14,
  },
  postPillThumb: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  postPillText: {
    flex: 1,
    minWidth: 0,
  },
  // ── Post row ───────────────────────────────────────────────────────────
  postRow: {
    marginHorizontal: 16,
    padding: 12,
    gap: 10,
    borderRadius: theme.borderRadius.large,
    borderCurve: "continuous",
    backgroundColor: theme.colors.inputBackground,
  },
  postRowPressed: {
    opacity: 0.85,
  },
  postRowMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  postThumb: {
    width: 56,
    height: 56,
    borderRadius: theme.borderRadius.medium,
    borderCurve: "continuous",
  },
  postThumbEmpty: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.pressHighlight,
  },
  postText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  postTitle: {
    fontFamily: theme.fonts.semiBold,
  },
  reviewText: {
    lineHeight: 21,
  },
  sectionLabel: {
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 6,
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.semiBold,
  },
  listContent: {
    flexGrow: 1,
  },
  // ── States ─────────────────────────────────────────────────────────────
  centeredState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
  },
  stateIcon: {
    color: theme.colors.textSecondary,
  },
  stateMessage: {
    color: theme.colors.textSecondary,
    textAlign: "center",
  },
  retryButton: {
    minWidth: 132,
    minHeight: 46,
    marginTop: 8,
    paddingHorizontal: 20,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.primary,
    backgroundImage: theme.colors.primaryGradient,
    alignItems: "center",
    justifyContent: "center",
  },
  retryButtonText: {
    color: theme.colors.buttonText,
  },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 20,
    marginVertical: 8,
    padding: 12,
    borderRadius: theme.borderRadius.medium,
    backgroundColor: theme.colors.inputBackground,
  },
  noticeIcon: {
    color: theme.colors.textSecondary,
  },
  noticeText: {
    flex: 1,
    color: theme.colors.textSecondary,
  },
  commentsError: {
    marginHorizontal: 20,
    marginVertical: 16,
    padding: 20,
    gap: 8,
    alignItems: "center",
    borderRadius: theme.borderRadius.large,
    backgroundColor: theme.colors.inputBackground,
  },
  inlineRetryButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  inlineRetryText: {
    color: theme.colors.primary,
  },
  commentsLoader: {
    marginVertical: 24,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    paddingVertical: 48,
    gap: 8,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    marginBottom: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primarySoft,
  },
  emptyIconGlyph: {
    color: theme.colors.onPrimarySoft,
  },
  quickReplies: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 8,
    marginTop: 12,
  },
  quickReply: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    justifyContent: "center",
    backgroundColor: theme.colors.inputBackground,
  },
  quickReplyText: {
    fontFamily: theme.fonts.medium,
  },
  // ── Composer ───────────────────────────────────────────────────────────
  composerArea: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    gap: 8,
  },
  composerStack: {
    gap: 8,
  },
  composer: {
    minHeight: COMPOSER_MIN_HEIGHT,
    borderRadius: COMPOSER_MIN_HEIGHT / 2,
    borderCurve: "continuous",
  },
  composerContent: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingLeft: 7,
    paddingRight: 6,
    paddingVertical: 2,
  },
  composerAvatar: {
    marginBottom: 5,
  },
  composerInput: {
    backgroundColor: "transparent",
    borderRadius: 0,
  },
  counter: {
    color: theme.colors.textSecondary,
    marginBottom: 13,
    marginRight: 8,
  },
  sendButton: {
    width: SEND_BUTTON_SIZE,
    height: SEND_BUTTON_SIZE,
    borderRadius: SEND_BUTTON_SIZE / 2,
    marginBottom: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
    backgroundImage: theme.colors.primaryGradient,
  },
  sendButtonPressed: {
    transform: [{ scale: 0.92 }],
  },
  sendIcon: {
    color: theme.colors.buttonText,
  },
  replyChipWrap: {
    alignSelf: "flex-start",
  },
  replyChip: {
    height: 32,
    borderRadius: 16,
  },
  replyChipContent: {
    height: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 12,
    paddingRight: 6,
  },
  replyChipIcon: {
    color: theme.colors.textSecondary,
  },
  replyChipText: {
    flexShrink: 1,
    color: theme.colors.textSecondary,
  },
  replyChipClose: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.pressHighlight,
  },
  mentionCard: {
    borderRadius: 24,
    borderCurve: "continuous",
    overflow: "hidden",
  },
  mentionScroll: {
    maxHeight: 4 * 50 + 12,
  },
  mentionScrollContent: {
    padding: 6,
  },
  mentionSuggestion: {
    minHeight: 50,
    paddingHorizontal: 10,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  mentionSuggestionPressed: {
    backgroundColor: theme.colors.pressHighlight,
  },
  mentionSuggestionText: {
    flex: 1,
    minWidth: 0,
  },
  mentionLoadingAvatar: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  // ── Shared ─────────────────────────────────────────────────────────────
  bold: {
    fontFamily: theme.fonts.semiBold,
  },
  secondary: {
    color: theme.colors.textSecondary,
  },
  secondaryIcon: {
    color: theme.colors.textSecondary,
  },
  dimmed: {
    opacity: 0.6,
  },
}));
