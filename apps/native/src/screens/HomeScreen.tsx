import { useNavigation } from "@react-navigation/native";
import {
  FlashList,
  type FlashListRef,
  type ListRenderItemInfo,
} from "@shopify/flash-list";
import { useState, useCallback, useMemo, useRef, memo, useEffect } from "react";
import {
  View,
  Pressable,
  RefreshControl,
  FlatList,
  Alert,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  Easing,
  type SharedValue,
  withSpring,
  useAnimatedScrollHandler,
  runOnJS,
} from "react-native-reanimated";
import {
  StyleSheet,
  UnistylesRuntime,
  useUnistyles,
} from "react-native-unistyles";
import { scheduleOnRN } from "react-native-worklets";

import {
  ActivityFeedListItem,
  useActivityFeed,
  useToggleActivityLike,
} from "@/api/activity";
import { useBlockUser } from "@/api/moderation";
import { useUnreadNotificationCount } from "@/api/notification";
import { useImportRecipe } from "@/api/recipe";
import { useUser, User } from "@/api/user";
import { Avatar } from "@/components/Avatar";
import { EmptyFeedState } from "@/components/EmptyFeedState";
import { ImportActivityCard } from "@/components/ImportActivityCard";
import { Ionicons } from "@/components/Ionicons";
import { NotificationBadge } from "@/components/NotificationBadge";
import {
  ReportContentSheet,
  type ReportContentSheetRef,
} from "@/components/ReportContentSheet";
import { ReviewActivityCard } from "@/components/ReviewActivityCard";
import { HomeFeedSkeleton, SkeletonContainer } from "@/components/Skeleton";
import { VSpace } from "@/components/Space";
import { Text } from "@/components/Text";
import { ScalePressable } from "@/components/buttons/ScalePressable";
import {
  FEED_CARD_INSET,
  FeedSeparator,
} from "@/components/feed/FeedCardParts";
import {
  GLASS_CONTROL_SIZE,
  GlassButtonGroup,
  GlassIconButton,
  GlassSurface,
} from "@/components/glass/Glass";
import { SignatureIcon } from "@/components/icons/SignatureIcon";
import {
  createRecipeImportId,
  useRecipeImport,
} from "@/features/recipe-import/RecipeImportProvider";
import { alertApiError } from "@/lib/apiErrorAlert";
import { useSessionContext } from "@/lib/sessionContext";
import { useSubscription } from "@/lib/subscription";
import { useTabScrollToTop } from "@/navigation/useTabScrollToTop";
import { selectFeedImagePreset } from "@/utils/imageUrl";

// ─── Header Component ─────────────────────────────────────────────────────────

interface HeaderProps {
  user: User | undefined;
  onAvatarPress: () => void;
  onSearchPress: () => void;
  onNotificationPress: () => void;
  unreadCount: number;
  isPro: boolean;
  titleOpacity: SharedValue<number>;
  /** Glass controls dematerialise while scrolling down the feed. */
  controlsHidden: boolean;
}

const Header = memo(
  ({
    user,
    onAvatarPress,
    onSearchPress,
    onNotificationPress,
    unreadCount,
    isPro,
    titleOpacity,
    controlsHidden,
  }: HeaderProps) => {
    const avatarScale = useSharedValue(1);
    const { theme } = useUnistyles();
    const iconColor = theme.colors.text;

    const titleAnimatedStyle = useAnimatedStyle(() => ({
      opacity: titleOpacity.get(),
    }));

    const avatarAnimatedStyle = useAnimatedStyle(() => ({
      transform: [{ scale: avatarScale.get() }],
    }));

    const notificationLabel =
      unreadCount > 0
        ? `Notifications, ${unreadCount} unread`
        : "Notifications";

    const handleAvatarPressIn = () => {
      avatarScale.set(withSpring(0.9, { mass: 1 }));
    };

    const handleAvatarPressOut = () => {
      avatarScale.set(withSpring(1));
    };

    return (
      <View style={styles.headerContainer}>
        <View style={styles.headerRow}>
          <Animated.View style={titleAnimatedStyle}>
            <Text type="screenTitle" style={styles.headerTitle}>
              cook
              <Text
                type="screenTitle"
                style={[styles.headerTitle, styles.clubText]}
              >
                club
              </Text>
            </Text>
          </Animated.View>
          <View style={styles.headerActions}>
            {/* Floating glass controls stay visible while the feed scrolls. */}
            <GlassButtonGroup hidden={controlsHidden}>
              <GlassIconButton
                accessibilityLabel="Search cooks"
                onPress={onSearchPress}
              >
                <SignatureIcon name="search" size={22} color={iconColor} />
              </GlassIconButton>
              <GlassIconButton
                accessibilityLabel={notificationLabel}
                onPress={onNotificationPress}
              >
                <View>
                  <SignatureIcon name="bell" size={22} color={iconColor} />
                  <NotificationBadge count={unreadCount} />
                </View>
              </GlassIconButton>
            </GlassButtonGroup>
            {user && (
              <Animated.View style={avatarAnimatedStyle}>
                {/* Avatar sits in its own glass circle beside the group. */}
                <GlassSurface
                  interactive
                  hidden={controlsHidden}
                  style={styles.avatarGlass}
                >
                  <Pressable
                    onPress={onAvatarPress}
                    onPressIn={handleAvatarPressIn}
                    onPressOut={handleAvatarPressOut}
                    accessibilityRole="button"
                    accessibilityLabel="Your profile"
                  >
                    <Avatar
                      imageUrl={user.image}
                      imageVersion={user.updatedAt}
                      name={user.name}
                      size={36}
                      isPro={isPro}
                    />
                  </Pressable>
                </GlassSurface>
              </Animated.View>
            )}
          </View>
        </View>
      </View>
    );
  },
);

// ─── Constants ───────────────────────────────────────────────────────────────
const HEADER_HEIGHT = 52; // Height of the cookclub title + avatar row
const LOAD_LATEST_SHOW_SCROLL_Y = 200;
const LOAD_LATEST_HIDE_SCROLL_Y = 120;
const LOAD_LATEST_SCROLL_DOWN_HIDE_DISTANCE = 48;
const LOAD_LATEST_SCROLL_UP_DELAY_MS = 500;
const LOAD_LATEST_ANIMATION_MS = 180;
const LOAD_LATEST_HEIGHT = 36;
const SCROLL_DIRECTION_THRESHOLD = 2;
const TAB_BAR_LIST_CLEARANCE = 112;
const ReanimatedFlashList = Animated.createAnimatedComponent(
  FlashList<ActivityFeedListItem>,
);

// ─── Main Component ───────────────────────────────────────────────────────────

export const HomeScreen = () => {
  const browseScrollRef = useRef<FlashListRef<ActivityFeedListItem>>(null);
  const reportSheetRef = useRef<ReportContentSheetRef>(null);
  const loadLatestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  useTabScrollToTop(browseScrollRef);
  const navigation = useNavigation();
  const theme = UnistylesRuntime.getTheme();
  const insets = UnistylesRuntime.insets;
  const { width: windowWidth } = useWindowDimensions();
  const feedImageWidth = Math.max(windowWidth - FEED_CARD_INSET * 2, 1);
  const feedImagePreset = useMemo(
    () => selectFeedImagePreset(feedImageWidth),
    [feedImageWidth],
  );
  const listBottomPadding = TAB_BAR_LIST_CLEARANCE;
  const importRecipeMutation = useImportRecipe();
  const blockUserMutation = useBlockUser();
  const { submitImport } = useRecipeImport();
  const session = useSessionContext();
  const { isPro, requireSmartImport } = useSubscription();

  // ─── State ────────────────────────────────────────────────────────────────────
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showLoadLatest, setShowLoadLatest] = useState(false);

  // Scroll tracking for header fade
  const titleOpacity = useSharedValue(1);
  const titleHidden = useSharedValue(false);
  const [controlsHidden, setControlsHidden] = useState(false);
  const controlsHiddenSV = useSharedValue(false);
  const previousScrollY = useSharedValue(0);
  const isScrollingTowardLatest = useSharedValue(false);
  const latestScrollMinY = useSharedValue(0);
  const loadLatestProgress = useSharedValue(0);

  useEffect(() => {
    loadLatestProgress.set(
      withTiming(showLoadLatest ? 1 : 0, {
        duration: LOAD_LATEST_ANIMATION_MS,
        easing: Easing.bezier(0.2, 0, 0, 1),
      }),
    );
  }, [loadLatestProgress, showLoadLatest]);

  useEffect(() => {
    return () => {
      if (loadLatestTimeoutRef.current) {
        clearTimeout(loadLatestTimeoutRef.current);
      }
    };
  }, []);

  // ─── API Hooks ────────────────────────────────────────────────────────────────
  const { data: userData } = useUser();
  const user = userData?.user;
  const currentUserId = user?.id ?? session?.user.id;

  // Notification unread count (poll every 60s)
  const { data: unreadData } = useUnreadNotificationCount({
    refetchInterval: 60000,
  });
  const unreadCount = unreadData?.count ?? 0;

  // Activity feed
  const {
    data: activityFeedItems = [],
    isPending: activityPending,
    isFetchingNextPage: activityFetchingNext,
    hasNextPage: activityHasNext,
    fetchNextPage: activityFetchNext,
    refetch: activityRefetch,
  } = useActivityFeed();

  const toggleLike = useToggleActivityLike();

  // ─── Handlers ─────────────────────────────────────────────────────────────────
  const handleAvatarPress = useCallback(() => {
    if (user?.id) {
      navigation.navigate("UserProfile", { userId: user.id });
    }
  }, [user?.id, navigation]);

  const handleNotificationPress = useCallback(() => {
    navigation.navigate("Notifications");
  }, [navigation]);

  const handleRecipePress = useCallback(
    (recipeId: number) => {
      navigation.navigate("RecipeDetail", { recipeId });
    },
    [navigation],
  );

  const handleUserPress = useCallback(
    (userId: string) => {
      navigation.navigate("UserProfile", { userId });
    },
    [navigation],
  );

  // Search lives on its own screen, pushed from the glass button.
  const handleSearchOpen = useCallback(() => {
    navigation.navigate("FindCooks");
  }, [navigation]);

  const hideLoadLatest = useCallback(() => {
    isScrollingTowardLatest.set(false);
    latestScrollMinY.set(0);

    if (loadLatestTimeoutRef.current) {
      clearTimeout(loadLatestTimeoutRef.current);
      loadLatestTimeoutRef.current = null;
    }
    setShowLoadLatest(false);
  }, [isScrollingTowardLatest, latestScrollMinY]);

  const scheduleLoadLatest = useCallback(() => {
    if (loadLatestTimeoutRef.current) {
      return;
    }

    loadLatestTimeoutRef.current = setTimeout(() => {
      loadLatestTimeoutRef.current = null;
      setShowLoadLatest(true);
    }, LOAD_LATEST_SCROLL_UP_DELAY_MS);
  }, []);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    hideLoadLatest();
    try {
      await activityRefetch();
    } finally {
      setIsRefreshing(false);
    }
  }, [activityRefetch, hideLoadLatest]);

  const handleLoadLatest = useCallback(async () => {
    browseScrollRef.current?.scrollToOffset({ offset: 0, animated: true });
    hideLoadLatest();
    await activityRefetch();
  }, [activityRefetch, hideLoadLatest]);

  const handleActivityLoadMore = useCallback(() => {
    if (activityHasNext && !activityFetchingNext) {
      activityFetchNext();
    }
  }, [activityHasNext, activityFetchingNext, activityFetchNext]);

  const handleDiscoverPress = handleSearchOpen;

  const sourceImportIdsRef = useRef(new Map<string, string>());

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
        await importRecipeMutation.mutateAsync({ recipeId });
        Alert.alert("Success", "Recipe added to your collection!");
      } catch (error: unknown) {
        alertApiError("Import Failed", error, {
          operation: "recipe.importExisting",
          fallback: "Failed to import recipe. Please try again.",
        });
      }
    },
    [importRecipeMutation],
  );

  const handleLikePress = useCallback(
    (activityEventId: number) => {
      toggleLike.mutate({ activityEventId });
    },
    [toggleLike],
  );

  const handleCommentPress = useCallback(
    (activityEventId: number) => {
      navigation.navigate("Activity", {
        activityEventId,
        focusCommentInput: true,
      });
    },
    [navigation],
  );

  const handleReportActivity = useCallback((activityEventId: number) => {
    reportSheetRef.current?.present({
      targetType: "activity",
      targetId: String(activityEventId),
    });
  }, []);

  const handleBlockUser = useCallback(
    (userId: string) => {
      Alert.alert(
        "Block this cook?",
        "You will no longer see each other's profiles or content. Previous follows will be removed.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Block",
            style: "destructive",
            onPress: () =>
              blockUserMutation.mutate(
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
    [blockUserMutation],
  );

  // ─── Scroll Handler with Header Fade ────────────────────────────────────────────
  const handleScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      const y = event.contentOffset.y;

      const nextTitleHidden = y > 5;
      if (titleHidden.get() !== nextTitleHidden) {
        titleHidden.set(nextTitleHidden);
        titleOpacity.set(
          withTiming(nextTitleHidden ? 0 : 1, {
            duration: 150,
          }),
        );
      }

      const deltaY = y - previousScrollY.get();

      // Glass controls dematerialise with the title as the feed leaves the
      // top, and return when it's scrolled back to the top.
      const nextControlsHidden = nextTitleHidden;
      if (controlsHiddenSV.get() !== nextControlsHidden) {
        controlsHiddenSV.set(nextControlsHidden);
        scheduleOnRN(setControlsHidden, nextControlsHidden);
      }
      const isAboveLatestShowThreshold = y > LOAD_LATEST_SHOW_SCROLL_Y;
      const isBelowLatestHideThreshold = y <= LOAD_LATEST_HIDE_SCROLL_Y;
      const isScrollingUp = deltaY < -SCROLL_DIRECTION_THRESHOLD;
      const isScrollingDown = deltaY > SCROLL_DIRECTION_THRESHOLD;

      if (isBelowLatestHideThreshold) {
        if (isScrollingTowardLatest.get()) {
          isScrollingTowardLatest.set(false);
          latestScrollMinY.set(0);
          runOnJS(hideLoadLatest)();
        }
      } else if (isAboveLatestShowThreshold && isScrollingUp) {
        latestScrollMinY.set(
          isScrollingTowardLatest.get()
            ? Math.min(latestScrollMinY.get(), y)
            : y,
        );
        if (!isScrollingTowardLatest.get()) {
          isScrollingTowardLatest.set(true);
          runOnJS(scheduleLoadLatest)();
        }
      } else if (
        isScrollingDown &&
        isScrollingTowardLatest.get() &&
        y - latestScrollMinY.get() > LOAD_LATEST_SCROLL_DOWN_HIDE_DISTANCE
      ) {
        isScrollingTowardLatest.set(false);
        latestScrollMinY.set(0);
        runOnJS(hideLoadLatest)();
      }

      previousScrollY.set(y);
    },
  });

  // ─── Activity Feed Render Function ────────────────────────────────────────────
  const getActivityItemType = useCallback(
    (item: ActivityFeedListItem) => item.type,
    [],
  );

  const renderActivityItem = useCallback(
    ({ item }: ListRenderItemInfo<ActivityFeedListItem>) => {
      if (item.type === "cooking_review") {
        return (
          <ReviewActivityCard
            activity={item}
            onRecipePress={handleRecipePress}
            onUserPress={handleUserPress}
            onLikePress={handleLikePress}
            onCommentPress={handleCommentPress}
            onReportPress={handleReportActivity}
            onBlockPress={handleBlockUser}
            onImportPress={handleImportRecipe}
            onImportRecipePress={handleImportExistingRecipe}
            currentUserId={currentUserId}
            timeAgo={item._display.timeAgo}
            imagePreset={feedImagePreset}
            imageWidth={feedImageWidth}
          />
        );
      }

      return (
        <ImportActivityCard
          activity={item}
          onRecipePress={handleRecipePress}
          onUserPress={handleUserPress}
          onLikePress={handleLikePress}
          onCommentPress={handleCommentPress}
          onReportPress={handleReportActivity}
          onBlockPress={handleBlockUser}
          onImportPress={handleImportRecipe}
          onImportRecipePress={handleImportExistingRecipe}
          currentUserId={currentUserId}
          timeAgo={item._display.timeAgo}
          imagePreset={feedImagePreset}
        />
      );
    },
    [
      handleRecipePress,
      handleUserPress,
      handleLikePress,
      handleCommentPress,
      handleReportActivity,
      handleBlockUser,
      handleImportRecipe,
      handleImportExistingRecipe,
      currentUserId,
      feedImagePreset,
      feedImageWidth,
    ],
  );

  const activityKeyExtractor = useCallback(
    (item: ActivityFeedListItem) => item.id,
    [],
  );

  // ─── Browse Mode Header ───────────────────────────────────────────────────────
  // The Header is rendered as a fixed element outside the list
  const BrowseListHeader = useMemo(
    () => <VSpace size={insets.top + HEADER_HEIGHT + 8} />,
    [insets.top],
  );

  // ─── Activity Feed Empty State ─────────────────────────────────────────────────
  const renderActivityEmpty = useCallback(() => {
    return <EmptyFeedState onDiscoverPress={handleDiscoverPress} />;
  }, [handleDiscoverPress]);

  // ─── Activity Feed Footer ──────────────────────────────────────────────────────
  const renderActivityFooter = useCallback(() => {
    if (!activityFetchingNext) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="large" />
        <VSpace size={20} />
      </View>
    );
  }, [activityFetchingNext]);

  const browseRefreshOffset = insets.top + HEADER_HEIGHT + 8;

  const loadLatestAnimatedStyle = useAnimatedStyle(() => ({
    opacity: loadLatestProgress.get(),
    transform: [
      {
        translateY: interpolate(loadLatestProgress.get(), [0, 1], [-8, 0]),
      },
      {
        scale: interpolate(loadLatestProgress.get(), [0, 1], [0.96, 1]),
      },
    ],
  }));

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <View style={styles.screen}>
      {/* Browse Mode - Activity Feed */}
      <Animated.View style={styles.listContainer}>
        <View style={styles.feedContainer}>
          <SkeletonContainer
            isLoading={activityPending}
            skeleton={
              <FlatList
                ListHeaderComponent={BrowseListHeader}
                ListEmptyComponent={HomeFeedSkeleton}
                data={[]}
                renderItem={() => null}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[
                  styles.feedContent,
                  { paddingBottom: listBottomPadding },
                ]}
              />
            }
          >
            <ReanimatedFlashList
              maintainVisibleContentPosition={{ disabled: true }}
              ref={browseScrollRef}
              data={activityFeedItems}
              renderItem={renderActivityItem}
              getItemType={getActivityItemType}
              keyExtractor={activityKeyExtractor}
              ListHeaderComponent={BrowseListHeader}
              ListEmptyComponent={renderActivityEmpty}
              ListFooterComponent={renderActivityFooter}
              ItemSeparatorComponent={FeedSeparator}
              onEndReached={handleActivityLoadMore}
              onEndReachedThreshold={0.5}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[
                styles.feedContent,
                { paddingBottom: listBottomPadding },
              ]}
              onScroll={handleScroll}
              scrollEventThrottle={16}
              refreshControl={
                <RefreshControl
                  refreshing={isRefreshing}
                  onRefresh={handleRefresh}
                  tintColor={theme.colors.primary}
                  colors={[theme.colors.primary]}
                  progressViewOffset={browseRefreshOffset}
                />
              }
            />
          </SkeletonContainer>
        </View>

        {/* Fixed Header - stays in place while content scrolls beneath */}
        <View style={styles.fixedHeader}>
          <Header
            user={user}
            onAvatarPress={handleAvatarPress}
            onSearchPress={handleSearchOpen}
            onNotificationPress={handleNotificationPress}
            unreadCount={unreadCount}
            isPro={isPro}
            titleOpacity={titleOpacity}
            controlsHidden={controlsHidden}
          />
        </View>

        <Animated.View
          style={[styles.loadLatestContainer, loadLatestAnimatedStyle]}
          pointerEvents={showLoadLatest ? "box-none" : "none"}
          accessibilityElementsHidden={!showLoadLatest}
          importantForAccessibility={
            showLoadLatest ? "auto" : "no-hide-descendants"
          }
        >
          <ScalePressable
            disabled={!showLoadLatest}
            onPress={handleLoadLatest}
            style={styles.loadLatestButton}
            accessibilityRole="button"
            accessibilityLabel="Load latest activity"
          >
            <Ionicons name="arrow-up" size={16} style={styles.loadLatestIcon} />
            <Text type="subheadline" style={styles.loadLatestText}>
              Latest
            </Text>
          </ScalePressable>
        </Animated.View>
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
  listContainer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  feedContainer: {
    flex: 1,
  },
  feedContent: {
    paddingBottom: rt.insets.bottom,
  },
  avatarGlass: {
    width: GLASS_CONTROL_SIZE,
    height: GLASS_CONTROL_SIZE,
    borderRadius: GLASS_CONTROL_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  fixedHeader: {
    position: "absolute",
    top: rt.insets.top,
    left: 0,
    right: 0,
  },
  headerContainer: {
    paddingHorizontal: 20,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    textAlignVertical: "center",
  },
  // The wordmark: 30pt Black, a touch larger than other screen titles.
  headerTitle: {
    fontSize: 30,
    lineHeight: 36,
  },
  clubText: {
    color: theme.colors.primary,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  searchModeHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  footerLoader: {
    paddingVertical: 20,
    alignItems: "center",
  },
  loadLatestContainer: {
    position: "absolute",
    // Centred on the header row. It only shows well down the feed, when the
    // title and glass controls have already dematerialised.
    top: rt.insets.top + (HEADER_HEIGHT - LOAD_LATEST_HEIGHT) / 2,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  loadLatestButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    height: LOAD_LATEST_HEIGHT,
    borderRadius: LOAD_LATEST_HEIGHT / 2,
    backgroundColor: theme.colors.primary,
    backgroundImage: theme.colors.primaryGradient,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
  loadLatestIcon: {
    color: theme.colors.buttonText,
  },
  loadLatestText: {
    color: theme.colors.buttonText,
    fontWeight: "600",
  },
}));
