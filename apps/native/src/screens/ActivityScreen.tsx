import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { findActiveMention, replaceActiveMention } from "@repo/shared";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Pressable,
  TextInput,
  View,
  useWindowDimensions,
  type ListRenderItemInfo,
  type TextInputSelectionChangeEvent,
} from "react-native";
import {
  KeyboardAvoidingView,
  useKeyboardHandler,
  useReanimatedKeyboardAnimation,
} from "react-native-keyboard-controller";
import Animated, {
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

import { useActivity, useToggleActivityLike } from "@/api/activity";
import {
  useCommentMentionSuggestions,
  useComments,
  useCreateComment,
  useDeleteComment,
  type Comment,
} from "@/api/comment";
import { useBlockUser } from "@/api/moderation";
import { useImportRecipe } from "@/api/recipe";
import { useUser } from "@/api/user";
import { Avatar } from "@/components/Avatar";
import { CommentCard } from "@/components/CommentCard";
import { ImportActivityCard } from "@/components/ImportActivityCard";
import { Ionicons } from "@/components/Ionicons";
import { MentionTextInput } from "@/components/MentionTextInput";
import { NavigationHeader } from "@/components/NavigationHeader";
import {
  ReportContentSheet,
  type ReportContentSheetRef,
} from "@/components/ReportContentSheet";
import { ReviewActivityCard } from "@/components/ReviewActivityCard";
import { Text } from "@/components/Text";
import {
  createRecipeImportId,
  useRecipeImport,
} from "@/features/recipe-import/RecipeImportProvider";
import { useDebounce } from "@/hooks/useDebounce";
import { alertApiError } from "@/lib/apiErrorAlert";
import { useSessionContext } from "@/lib/sessionContext";
import { useSubscription } from "@/lib/subscription";
import type { RootStackParamList } from "@/navigation/navigationRef";
import { selectFeedImagePreset } from "@/utils/imageUrl";

const MAX_SCROLL_RETRIES = 2;
const SCROLL_RETRY_DELAY_MS = 150;
const NAVIGATION_HEADER_HEIGHT = 60;
const MAX_MENTION_SUGGESTIONS = 10;
const MENTION_SEARCH_DEBOUNCE_MS = 300;

type ActivityScreenRoute = RouteProp<RootStackParamList, "Activity">;

type CommentListItem = {
  comment: Comment;
  isReply: boolean;
};

const ReanimatedFlatList = Animated.createAnimatedComponent(
  FlatList<CommentListItem>,
);

export const ActivityScreen = () => {
  const navigation = useNavigation();
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
  const { width: windowWidth } = useWindowDimensions();
  const { theme } = useUnistyles();
  const insets = UnistylesRuntime.insets;
  const { progress: keyboardProgress } = useReanimatedKeyboardAnimation();
  const listRef = useAnimatedRef<FlatList<CommentListItem>>();
  const inputRef = useRef<TextInput>(null);
  const reportSheetRef = useRef<ReportContentSheetRef>(null);
  const scrollRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const scrollRetryCountRef = useRef(0);
  const completedFocusRef = useRef<number | null>(null);
  const sourceImportIdsRef = useRef(new Map<string, string>());
  const commentsScrollBaseOffsetRef = useRef<number | null>(null);
  const shouldRestoreCommentsScrollRef = useRef(false);
  const headerOpacity = useSharedValue(1);
  const headerHidden = useSharedValue(false);
  const listScrollOffset = useSharedValue(0);
  const listScrollBase = useSharedValue(0);
  const listKeyboardOffset = useSharedValue(0);

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

  // Suggestions temporarily replace the comment rows. Capture a
  // keyboard-independent offset before that shorter content can clamp the
  // list, then restore it once the comments have been laid out again.
  useLayoutEffect(() => {
    if (showMentionSelector) {
      if (commentsScrollBaseOffsetRef.current === null) {
        commentsScrollBaseOffsetRef.current = Math.max(
          0,
          listScrollOffset.get() - listKeyboardOffset.get(),
        );
      }
      shouldRestoreCommentsScrollRef.current = false;
      return;
    }

    if (commentsScrollBaseOffsetRef.current !== null) {
      shouldRestoreCommentsScrollRef.current = true;
    }
  }, [showMentionSelector]);

  const feedImageWidth = Math.max(windowWidth - 40, 1);
  const feedImagePreset = useMemo(
    () => selectFeedImagePreset(feedImageWidth),
    [feedImageWidth],
  );
  const inputAreaAnimatedStyle = useAnimatedStyle(() => ({
    paddingBottom: interpolate(
      keyboardProgress.get(),
      [0, 1],
      [insets.bottom + 10, 10],
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
      const nextHeaderHidden = event.contentOffset.y > 5;
      if (headerHidden.get() !== nextHeaderHidden) {
        headerHidden.set(nextHeaderHidden);
        headerOpacity.set(
          withTiming(nextHeaderHidden ? 0 : 1, {
            duration: 150,
          }),
        );
      }
    },
  });

  const headerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: headerOpacity.get(),
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
  const activityActorName = activity?.actor.name;
  const { mutate: toggleLike } = useToggleActivityLike();
  const { mutateAsync: createComment, isPending: isCreatingComment } =
    useCreateComment();
  const { mutateAsync: deleteComment } = useDeleteComment(activityEventId);
  const { mutate: blockUser } = useBlockUser();
  const { mutateAsync: importExistingRecipe } = useImportRecipe();
  const { submitImport } = useRecipeImport();
  const { requireSmartImport } = useSubscription();

  const flattenedComments = useMemo<CommentListItem[]>(
    () =>
      commentsData?.comments.flatMap((comment) => [
        { comment, isReply: false },
        ...comment.replies.map((reply) => ({ comment: reply, isReply: true })),
      ]) ?? [],
    [commentsData?.comments],
  );

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
    commentsScrollBaseOffsetRef.current = null;
    shouldRestoreCommentsScrollRef.current = false;
    Keyboard.dismiss();
  }, [activityEventId]);

  useEffect(() => {
    if (
      !activity ||
      focusedCommentId === undefined ||
      commentsData?.focusedCommentStatus !== "found" ||
      completedFocusRef.current === focusedCommentId
    ) {
      return;
    }

    const targetIndex = flattenedComments.findIndex(
      ({ comment }) => comment.id === focusedCommentId,
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
    flattenedComments,
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

  const handleListContentSizeChange = useCallback(() => {
    const savedBaseOffset = commentsScrollBaseOffsetRef.current;
    if (!shouldRestoreCommentsScrollRef.current || savedBaseOffset === null) {
      return;
    }

    const restoredOffset = Math.max(
      0,
      savedBaseOffset + listKeyboardOffset.get(),
    );
    shouldRestoreCommentsScrollRef.current = false;
    commentsScrollBaseOffsetRef.current = null;
    listScrollBase.set(savedBaseOffset);
    listScrollOffset.set(restoredOffset);
    listRef.current?.scrollToOffset({
      offset: restoredOffset,
      animated: false,
    });
  }, []);

  const handleRecipePress = useCallback(
    (recipeId: number) => {
      navigation.navigate("RecipeDetail", { recipeId });
    },
    [navigation],
  );

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

  const handleImportRecipe = useCallback(
    async (sourceUrl: string) => {
      try {
        const allowed = await requireSmartImport();
        if (!allowed) {
          navigation.navigate("Tabs", { screen: "Add recipe" });
          return;
        }

        const id =
          sourceImportIdsRef.current.get(sourceUrl) ?? createRecipeImportId();
        sourceImportIdsRef.current.set(sourceUrl, id);
        await submitImport({
          id,
          importType: "smart",
          source: { type: "url", value: sourceUrl },
        });
        sourceImportIdsRef.current.delete(sourceUrl);
        navigation.navigate("Tabs", { screen: "Add recipe" });
      } catch (error) {
        alertApiError("Import Failed", error, {
          operation: "recipeImport.create",
          fallback: "Unable to start this import. Please try again.",
        });
      }
    },
    [navigation, requireSmartImport, submitImport],
  );

  const handleImportExistingRecipe = useCallback(
    async (recipeId: number) => {
      try {
        await importExistingRecipe({ recipeId });
        Alert.alert("Success", "Recipe added to your collection!");
      } catch (error) {
        alertApiError("Import Failed", error, {
          operation: "recipe.importExisting",
          fallback: "Failed to import recipe. Please try again.",
        });
      }
    },
    [importExistingRecipe],
  );

  const handleLikePress = useCallback(() => {
    toggleLike({ activityEventId });
  }, [activityEventId, toggleLike]);

  const handleCommentPress = useCallback(() => {
    inputRef.current?.focus();
  }, []);

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

  const handleReply = useCallback((comment: Comment) => {
    setReplyingTo(comment);
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
    if (!content) return;

    Keyboard.dismiss();
    try {
      await createComment({
        activityEventId,
        parentCommentId: replyingTo?.id,
        content,
      });
      setCommentText("");
      setCommentSelection({ start: 0, end: 0 });
      setTaggedUsernames(new Set());
      setReplyingTo(null);
    } catch (error) {
      alertApiError("Couldn’t Post Comment", error, {
        operation: "comment.create",
        fallback: "Failed to post comment. Please try again.",
      });
    }
  }, [activityEventId, commentText, createComment, replyingTo]);

  const handleBlockActivityAuthor = useCallback(
    (userId: string) => {
      if (activityActorName) {
        handleBlock(userId, activityActorName);
      }
    },
    [activityActorName, handleBlock],
  );

  const renderComment = useCallback(
    ({ item }: ListRenderItemInfo<CommentListItem>) => (
      <View style={styles.commentRow}>
        <CommentCard
          comment={item.comment}
          isReply={item.isReply}
          isFocused={item.comment.id === focusedCommentId}
          isOwnComment={item.comment.user.id === currentUserId}
          onReply={handleReply}
          onDelete={handleDelete}
          onReport={handleReportComment}
          onBlock={handleBlock}
          onMentionPress={handleUserPress}
        />
      </View>
    ),
    [
      currentUserId,
      focusedCommentId,
      handleBlock,
      handleDelete,
      handleReply,
      handleReportComment,
      handleUserPress,
    ],
  );

  const keyExtractor = useCallback(
    ({ comment }: CommentListItem) => comment.id.toString(),
    [],
  );

  const handleRetry = useCallback(() => {
    refetchActivity();
    refetchComments();
  }, [refetchActivity, refetchComments]);

  if (isActivityLoading) {
    return (
      <View style={styles.screen}>
        <View style={styles.centeredState}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
        <Animated.View style={styles.fixedHeader}>
          <NavigationHeader title="Activity" onBackPress={handleBackPress} />
        </Animated.View>
      </View>
    );
  }

  if (isActivityError || !activity) {
    return (
      <View style={styles.screen}>
        <View style={styles.centeredState}>
          <Ionicons
            name="document-outline"
            size={44}
            style={styles.stateIcon}
          />
          <Text type="title3">Activity unavailable</Text>
          <Text type="body" style={styles.stateMessage}>
            This activity may have been removed or is no longer available.
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={isActivityFetching}
            onPress={handleRetry}
            style={({ pressed }) => [
              styles.retryButton,
              pressed && styles.retryButtonPressed,
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
        </View>
        <Animated.View style={styles.fixedHeader}>
          <NavigationHeader title="Activity" onBackPress={handleBackPress} />
        </Animated.View>
      </View>
    );
  }

  const activityCard =
    activity.type === "cooking_review" ? (
      <ReviewActivityCard
        activity={activity}
        onRecipePress={handleRecipePress}
        onUserPress={handleUserPress}
        onLikePress={handleLikePress}
        onCommentPress={handleCommentPress}
        onReportPress={handleReportActivity}
        onBlockPress={handleBlockActivityAuthor}
        onImportPress={handleImportRecipe}
        onImportRecipePress={handleImportExistingRecipe}
        currentUserId={currentUserId}
        imagePreset={feedImagePreset}
        imageWidth={feedImageWidth}
        imagePriority="high"
      />
    ) : (
      <ImportActivityCard
        activity={activity}
        onRecipePress={handleRecipePress}
        onUserPress={handleUserPress}
        onLikePress={handleLikePress}
        onCommentPress={handleCommentPress}
        onReportPress={handleReportActivity}
        onBlockPress={handleBlockActivityAuthor}
        onImportPress={handleImportRecipe}
        onImportRecipePress={handleImportExistingRecipe}
        currentUserId={currentUserId}
        imagePreset={feedImagePreset}
        imagePriority="high"
      />
    );

  const commentsHeader = (
    <>
      {activityCard}
      {!showMentionSelector ? (
        <View style={styles.sectionHeader}>
          <Text type="title3">Comments</Text>
          <Text type="footnote" style={styles.commentCount}>
            {activity.commentCount}
          </Text>
        </View>
      ) : null}
      {!showMentionSelector && focusedCommentUnavailable ? (
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
      {!showMentionSelector && areCommentsError ? (
        <View style={styles.commentsError}>
          <Text type="headline">Comments unavailable</Text>
          <Text type="subheadline" style={styles.stateMessage}>
            We couldn’t load the comments for this activity.
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
      {!showMentionSelector && areCommentsLoading ? (
        <ActivityIndicator style={styles.commentsLoader} />
      ) : null}
    </>
  );

  const mentionSelector = showMentionSelector ? (
    <View style={styles.mentionSuggestions}>
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
          <View style={styles.mentionSuggestionIdentity}>
            <Avatar
              imageUrl={suggestion.image}
              name={suggestion.name}
              size={34}
              subscriptionTier={suggestion.subscriptionTier}
            />
            <View style={styles.mentionSuggestionText}>
              <Text
                type="headline"
                numberOfLines={1}
                style={styles.mentionSuggestionName}
              >
                {suggestion.name}
              </Text>
              <Text
                type="footnote"
                numberOfLines={1}
                style={styles.mentionSuggestionUsername}
              >
                @{suggestion.username}
              </Text>
            </View>
          </View>
        </Pressable>
      ))}
      {areMentionSuggestionsLoading ? (
        <View accessibilityLiveRegion="polite" style={styles.mentionSuggestion}>
          <View style={styles.mentionSuggestionIdentity}>
            <View style={styles.mentionSuggestionLoadingAvatar}>
              <ActivityIndicator size="small" />
            </View>
            <View style={styles.mentionSuggestionText}>
              <Text type="footnote" style={styles.mentionSuggestionLoadingText}>
                {mentionQuery
                  ? `Searching for "${mentionQuery}"`
                  : "Searching for suggestions"}
              </Text>
            </View>
          </View>
        </View>
      ) : areMentionSuggestionsError ? (
        <View style={styles.mentionSuggestionState}>
          <Text type="footnote" style={styles.mentionSuggestionHint}>
            Couldn’t load tag suggestions.
          </Text>
        </View>
      ) : null}
    </View>
  ) : null;

  const canSubmit = commentText.trim().length > 0 && !isCreatingComment;

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.keyboardArea}
        behavior="height"
        keyboardVerticalOffset={0}
      >
        <ReanimatedFlatList
          ref={listRef}
          data={
            showMentionSelector || areCommentsError ? [] : flattenedComments
          }
          renderItem={renderComment}
          keyExtractor={keyExtractor}
          ListHeaderComponent={commentsHeader}
          ListEmptyComponent={
            showMentionSelector ? (
              mentionSelector
            ) : !areCommentsLoading &&
              !areCommentsError &&
              !focusedCommentUnavailable ? (
              <View style={styles.emptyComments}>
                <Text type="body" style={styles.stateMessage}>
                  No comments yet. Be the first to comment.
                </Text>
              </View>
            ) : null
          }
          contentContainerStyle={[
            styles.listContent,
            { paddingTop: insets.top + NAVIGATION_HEADER_HEIGHT },
          ]}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={handleListContentSizeChange}
          onScroll={handleScroll}
          onScrollToIndexFailed={handleScrollToIndexFailed}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={showMentionSelector}
        />

        {!areCommentsError ? (
          <Animated.View style={[styles.inputArea, inputAreaAnimatedStyle]}>
            {replyingTo ? (
              <View style={styles.replyingToBar}>
                <Text type="footnote" style={styles.replyingToText}>
                  Replying to {replyingTo.user.name}
                </Text>
                <Pressable
                  accessibilityLabel="Cancel reply"
                  onPress={() => setReplyingTo(null)}
                  hitSlop={8}
                >
                  <Ionicons
                    name="close"
                    size={18}
                    style={styles.replyingToIcon}
                  />
                </Pressable>
              </View>
            ) : null}
            <View style={styles.inputRow}>
              <MentionTextInput
                ref={inputRef}
                accessibilityLabel="Comment"
                value={commentText}
                taggedUsernames={taggedUsernames}
                onChangeText={setCommentText}
                selection={commentSelection}
                onSelectionChange={handleCommentSelectionChange}
                placeholder={replyingTo ? "Write a reply…" : "Add a comment…"}
                placeholderTextColor={theme.colors.placeholderText}
                cursorColor={theme.colors.primary}
                selectionColor={theme.colors.primary}
                multiline
                maxLength={500}
              />
              <Pressable
                accessibilityLabel="Post comment"
                accessibilityRole="button"
                disabled={!canSubmit}
                onPress={handleSubmit}
                style={({ pressed }) => [
                  styles.sendButton,
                  !canSubmit && styles.sendButtonDisabled,
                  pressed && canSubmit && styles.sendButtonPressed,
                ]}
              >
                {isCreatingComment ? (
                  <ActivityIndicator
                    color={theme.colors.buttonText}
                    size="small"
                  />
                ) : (
                  <Ionicons name="send" size={18} style={styles.sendIcon} />
                )}
              </Pressable>
            </View>
          </Animated.View>
        ) : null}
      </KeyboardAvoidingView>
      <Animated.View style={[styles.fixedHeader, headerAnimatedStyle]}>
        <NavigationHeader title="Activity" onBackPress={handleBackPress} />
      </Animated.View>
      <ReportContentSheet ref={reportSheetRef} />
    </View>
  );
};

const styles = StyleSheet.create((theme, rt) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  fixedHeader: {
    position: "absolute",
    top: rt.insets.top,
    left: rt.insets.left,
    right: rt.insets.right,
  },
  keyboardArea: {
    flex: 1,
  },
  centeredState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
  },
  stateIcon: {
    color: theme.colors.textTertiary,
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
    borderRadius: theme.borderRadius.medium,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  retryButtonPressed: {
    opacity: 0.8,
  },
  retryButtonText: {
    color: theme.colors.buttonText,
  },
  listContent: {
    paddingBottom: 20,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  commentCount: {
    color: theme.colors.textSecondary,
  },
  commentRow: {
    paddingHorizontal: 20,
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
  emptyComments: {
    paddingHorizontal: 20,
    paddingVertical: 32,
  },
  inputArea: {
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.background,
  },
  replyingToBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.borderRadius.small,
    backgroundColor: theme.colors.inputBackground,
  },
  replyingToText: {
    flex: 1,
    color: theme.colors.textSecondary,
  },
  replyingToIcon: {
    color: theme.colors.textSecondary,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  mentionSuggestions: {
    paddingHorizontal: 20,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.background,
  },
  mentionSuggestion: {
    minHeight: 52,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  mentionSuggestionPressed: {
    backgroundColor: theme.colors.inputBackground,
  },
  mentionSuggestionIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  mentionSuggestionText: {
    flex: 1,
    minWidth: 0,
  },
  mentionSuggestionName: {
    textAlign: "left",
  },
  mentionSuggestionUsername: {
    color: theme.colors.textSecondary,
    textAlign: "left",
  },
  mentionSuggestionState: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  mentionSuggestionLoadingAvatar: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  mentionSuggestionLoadingText: {
    color: theme.colors.textSecondary,
    textAlign: "left",
  },
  mentionSuggestionHint: {
    color: theme.colors.textSecondary,
    textAlign: "center",
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
  },
  sendButtonDisabled: {
    opacity: 0.45,
  },
  sendButtonPressed: {
    transform: [{ scale: 0.96 }],
  },
  sendIcon: {
    color: theme.colors.buttonText,
  },
}));
