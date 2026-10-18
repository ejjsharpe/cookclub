import { useNavigation, useScrollToTop } from "@react-navigation/native";
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
  Dimensions,
  useWindowDimensions,
  type TextInput,
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
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";
import { scheduleOnRN } from "react-native-worklets";

import {
  ActivityFeedListItem,
  useActivityFeed,
  useToggleActivityLike,
} from "@/api/activity";
import {
  useFollowing,
  useSearchUsers,
  useSuggestedUsers,
  type SearchUser,
} from "@/api/follows";
import { useBlockUser } from "@/api/moderation";
import { useUnreadNotificationCount } from "@/api/notification";
import { useImportRecipe } from "@/api/recipe";
import { useUser, User } from "@/api/user";
import { Avatar } from "@/components/Avatar";
import { EmptyFeedState } from "@/components/EmptyFeedState";
import { FollowUserRow } from "@/components/FollowUserRow";
import { ImportActivityCard } from "@/components/ImportActivityCard";
import { Ionicons } from "@/components/Ionicons";
import { NotificationBadge } from "@/components/NotificationBadge";
import {
  ReportContentSheet,
  type ReportContentSheetRef,
} from "@/components/ReportContentSheet";
import { ReviewActivityCard } from "@/components/ReviewActivityCard";
import { SearchBar, SEARCH_BAR_HEIGHT } from "@/components/SearchBar";
import { HomeFeedSkeleton, SkeletonContainer } from "@/components/Skeleton";
import { VSpace } from "@/components/Space";
import { Text } from "@/components/Text";
import { ScalePressable } from "@/components/buttons/ScalePressable";
import {
  createRecipeImportId,
  useRecipeImport,
} from "@/features/recipe-import/RecipeImportProvider";
import { useDebounce } from "@/hooks/useDebounce";
import { alertApiError } from "@/lib/apiErrorAlert";
import { useSessionContext } from "@/lib/sessionContext";
import { useSubscription } from "@/lib/subscription";
import { selectFeedImagePreset } from "@/utils/imageUrl";

// ─── Header Component ─────────────────────────────────────────────────────────

interface HeaderProps {
  user: User | undefined;
  onAvatarPress: () => void;
  onNotificationPress: () => void;
  unreadCount: number;
  isPro: boolean;
  titleOpacity: SharedValue<number>;
  avatarOpacity: SharedValue<number>;
}

const Header = memo(
  ({
    user,
    onAvatarPress,
    onNotificationPress,
    unreadCount,
    isPro,
    titleOpacity,
    avatarOpacity,
  }: HeaderProps) => {
    const notificationScale = useSharedValue(1);
    const avatarScale = useSharedValue(1);

    const titleAnimatedStyle = useAnimatedStyle(() => ({
      opacity: titleOpacity.get(),
    }));

    const avatarOpacityStyle = useAnimatedStyle(() => ({
      opacity: avatarOpacity.get(),
    }));

    const notificationAnimatedStyle = useAnimatedStyle(() => ({
      transform: [{ scale: notificationScale.get() }],
    }));

    const avatarAnimatedStyle = useAnimatedStyle(() => ({
      transform: [{ scale: avatarScale.get() }],
    }));

    const handleNotificationPressIn = () => {
      notificationScale.set(withSpring(0.9, { mass: 1 }));
    };

    const handleNotificationPressOut = () => {
      notificationScale.set(withSpring(1));
    };

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
            <Animated.View
              style={[avatarOpacityStyle, notificationAnimatedStyle]}
            >
              <Pressable
                onPress={onNotificationPress}
                onPressIn={handleNotificationPressIn}
                onPressOut={handleNotificationPressOut}
                style={styles.notificationButton}
              >
                <Ionicons
                  name="notifications"
                  size={24}
                  style={styles.notificationIcon}
                />
                <NotificationBadge count={unreadCount} />
              </Pressable>
            </Animated.View>
            {user && (
              <Animated.View style={[avatarOpacityStyle, avatarAnimatedStyle]}>
                <Pressable
                  onPress={onAvatarPress}
                  onPressIn={handleAvatarPressIn}
                  onPressOut={handleAvatarPressOut}
                >
                  <Avatar
                    imageUrl={user.image}
                    imageVersion={user.updatedAt}
                    name={user.name}
                    size={44}
                    isPro={isPro}
                  />
                </Pressable>
              </Animated.View>
            )}
          </View>
        </View>
      </View>
    );
  },
);

// ─── Constants ───────────────────────────────────────────────────────────────
const { width: SCREEN_WIDTH } = Dimensions.get("window");
const HORIZONTAL_PADDING = 20;
const BACK_BUTTON_WIDTH = 44;
const HEADER_GAP = 6;
const HEADER_HEIGHT = 52; // Height of the cookclub title + avatar row
const SEARCH_START_WIDTH = SCREEN_WIDTH - HORIZONTAL_PADDING * 2;
const SEARCH_END_WIDTH =
  SCREEN_WIDTH - HORIZONTAL_PADDING * 2 - BACK_BUTTON_WIDTH - HEADER_GAP;
const BACK_BUTTON_OFFSET = BACK_BUTTON_WIDTH + HEADER_GAP;
const LOAD_LATEST_SHOW_SCROLL_Y = 200;
const LOAD_LATEST_HIDE_SCROLL_Y = 120;
const LOAD_LATEST_SCROLL_DOWN_HIDE_DISTANCE = 48;
const LOAD_LATEST_SCROLL_UP_DELAY_MS = 500;
const LOAD_LATEST_ANIMATION_MS = 180;
const SCROLL_DIRECTION_THRESHOLD = 2;
const TAB_BAR_LIST_CLEARANCE = 112;
const NOOP = () => {};

const ActivitySeparator = () => <VSpace size={16} />;
const SearchUserSeparator = () => <VSpace size={6} />;
const ReanimatedFlashList = Animated.createAnimatedComponent(
  FlashList<ActivityFeedListItem>,
);

type HomeSearchUser = SearchUser & {
  recipeCount?: number;
  followerCount?: number;
};

interface SearchUserRowProps {
  user: HomeSearchUser;
  isFollowing: boolean;
  onUserPress: (userId: string) => void;
}

const SearchUserRow = memo(
  ({ user, isFollowing, onUserPress }: SearchUserRowProps) => {
    const handlePress = useCallback(() => {
      onUserPress(user.id);
    }, [user.id, onUserPress]);

    return (
      <FollowUserRow
        user={user}
        isFollowing={isFollowing}
        onUserPress={handlePress}
        style={styles.userRow}
      />
    );
  },
);

// ─── Main Component ───────────────────────────────────────────────────────────

export const HomeScreen = () => {
  const browseScrollRef = useRef<FlashListRef<ActivityFeedListItem>>(null);
  const searchListRef = useRef<FlatList>(null);
  const searchBarRef = useRef<View>(null);
  const reportSheetRef = useRef<ReportContentSheetRef>(null);
  const loadLatestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  useScrollToTop(browseScrollRef);
  const navigation = useNavigation();
  const theme = UnistylesRuntime.getTheme();
  const insets = UnistylesRuntime.insets;
  const { width: windowWidth } = useWindowDimensions();
  const feedImageWidth = Math.max(windowWidth - HORIZONTAL_PADDING * 2, 1);
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
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [showFloatingSearch, setShowFloatingSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showLoadLatest, setShowLoadLatest] = useState(false);

  // Track the search bar's Y position relative to the screen
  const searchBarY = useSharedValue(0);
  const searchBarMeasuredY = useRef(0);
  const searchInputRef = useRef<TextInput>(null);

  // Animation progress (0 = browse, 1 = search)
  const searchProgress = useSharedValue(0);

  // Scroll tracking for header fade
  const titleOpacity = useSharedValue(1);
  const avatarOpacity = useSharedValue(1);
  const titleHidden = useSharedValue(false);
  const avatarHidden = useSharedValue(false);
  const previousScrollY = useSharedValue(0);
  const isScrollingTowardLatest = useSharedValue(false);
  const latestScrollMinY = useSharedValue(0);
  const loadLatestProgress = useSharedValue(0);

  // Target Y position for search mode (at the top where the header is)
  const searchModeY = insets.top;

  const animationConfig = useMemo(
    () => ({
      duration: 250,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
    }),
    [],
  );

  const focusSearchInput = useCallback(() => {
    searchInputRef.current?.focus();
  }, []);

  const hideFloatingSearch = useCallback(() => {
    setShowFloatingSearch(false);
  }, []);

  useEffect(() => {
    if (isSearchActive) {
      // Show floating search immediately when entering search mode
      setShowFloatingSearch(true);
      searchProgress.set(
        withTiming(1, animationConfig, (finished) => {
          if (finished) {
            scheduleOnRN(focusSearchInput);
          }
        }),
      );
    } else {
      // Animate out, then hide floating search after animation completes
      searchProgress.set(
        withTiming(0, animationConfig, (finished) => {
          if (finished) {
            scheduleOnRN(hideFloatingSearch);
          }
        }),
      );
    }
  }, [
    focusSearchInput,
    hideFloatingSearch,
    isSearchActive,
    animationConfig,
    searchProgress,
  ]);

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

  // Debounce search query
  const debouncedSearch = useDebounce(searchQuery, 300);

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

  // Search condition - only search users after two characters; otherwise show suggestions.
  const isSearchingUsers = debouncedSearch.length >= 2;

  const {
    data: usersData,
    isPending: usersPending,
    refetch: usersRefetch,
    isFetching: usersFetching,
  } = useSearchUsers({
    query: debouncedSearch,
    limit: 20,
  });
  const {
    data: suggestedUsers,
    isPending: suggestedUsersPending,
    refetch: suggestedUsersRefetch,
    isFetching: suggestedUsersFetching,
  } = useSuggestedUsers(20, isSearchActive);
  const { data: following } = useFollowing();
  const followingIds = useMemo(
    () => new Set(following?.map((f) => f.user.id) ?? []),
    [following],
  );

  const toggleLike = useToggleActivityLike();

  const users: HomeSearchUser[] = useMemo(() => {
    if (isSearchingUsers) return usersData ?? [];
    return suggestedUsers ?? [];
  }, [isSearchingUsers, suggestedUsers, usersData]);

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

  const handleSearchFocus = useCallback(() => {
    // Measure the search bar position before transitioning
    searchBarRef.current?.measureInWindow((_x, y) => {
      searchBarMeasuredY.current = y;
      searchBarY.set(y);
      setIsSearchActive(true);
    });
  }, [searchBarY]);

  const handleExitSearch = useCallback(() => {
    setIsSearchActive(false);
    setSearchQuery("");
  }, []);

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

  useEffect(() => {
    if (isSearchActive) {
      hideLoadLatest();
    }
  }, [hideLoadLatest, isSearchActive]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    if (isSearchActive) {
      try {
        if (isSearchingUsers) {
          await usersRefetch();
        } else {
          await suggestedUsersRefetch();
        }
      } finally {
        setIsRefreshing(false);
      }
    } else {
      hideLoadLatest();
      try {
        await activityRefetch();
      } finally {
        setIsRefreshing(false);
      }
    }
  }, [
    isSearchActive,
    isSearchingUsers,
    usersRefetch,
    suggestedUsersRefetch,
    activityRefetch,
    hideLoadLatest,
  ]);

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

  const handleDiscoverPress = useCallback(() => {
    // Measure the search bar position before transitioning (same as handleSearchFocus)
    searchBarRef.current?.measureInWindow((_x, y) => {
      searchBarMeasuredY.current = y;
      searchBarY.set(y);
      setIsSearchActive(true);
    });
  }, [searchBarY]);

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

      const nextAvatarHidden = y > 10;
      if (avatarHidden.get() !== nextAvatarHidden) {
        avatarHidden.set(nextAvatarHidden);
        avatarOpacity.set(
          withTiming(nextAvatarHidden ? 0 : 1, {
            duration: 150,
          }),
        );
      }

      const deltaY = y - previousScrollY.get();
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

  // ─── Render Functions ─────────────────────────────────────────────────────────
  const renderUser = useCallback(
    ({ item }: { item: HomeSearchUser }) => (
      <SearchUserRow
        user={item}
        isFollowing={followingIds.has(item.id)}
        onUserPress={handleUserPress}
      />
    ),
    [followingIds, handleUserPress],
  );

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
          sourceDescription={item._display.sourceDescription}
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
    () => (
      <>
        <VSpace size={insets.top + HEADER_HEIGHT + 8} />
        <Pressable
          ref={searchBarRef}
          style={[
            styles.searchContainer,
            showFloatingSearch && styles.searchBarHidden,
          ]}
          onPress={handleSearchFocus}
        >
          <View pointerEvents="none">
            <SearchBar
              value=""
              onChangeText={NOOP}
              placeholder="Search cooks..."
            />
          </View>
        </Pressable>
        <VSpace size={8} />
      </>
    ),
    [showFloatingSearch, handleSearchFocus, insets.top],
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

  // ─── Search Mode Header ───────────────────────────────────────────────────────
  // The search bar and back button are rendered as fixed elements outside the FlatList.
  // FlatList only contains search results with top spacing for the fixed header.
  const SearchListHeader = useMemo(
    () => (
      <View style={styles.searchListHeader}>
        <VSpace size={insets.top + SEARCH_BAR_HEIGHT + 20} />
        <Text type="title2" style={styles.searchTitle}>
          Find cooks
        </Text>
        <VSpace size={6} />
        <Text type="bodyFaded" style={styles.searchSubtitle}>
          See what they're cooking in your feed
        </Text>
        <VSpace size={16} />
      </View>
    ),
    [insets.top],
  );

  // ─── Search Empty State ───────────────────────────────────────────────────────
  const isFetching = isSearchingUsers
    ? usersPending || usersFetching
    : suggestedUsersPending || suggestedUsersFetching;

  const browseRefreshOffset = insets.top + HEADER_HEIGHT + 8;
  const searchRefreshOffset = insets.top + SEARCH_BAR_HEIGHT + 16;

  const renderSearchEmpty = () => {
    if (isFetching) {
      return (
        <View style={styles.searchStateContainer}>
          <ActivityIndicator size="large" />
          <VSpace size={16} />
          <Text type="bodyFaded">
            {isSearchingUsers ? "Searching cooks..." : "Finding cooks..."}
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.searchStateContainer}>
        <Text type="bodyFaded" style={styles.searchStateText}>
          {isSearchingUsers ? "No cooks found" : "No suggestions available"}
        </Text>
      </View>
    );
  };

  const searchKeyExtractor = (item: HomeSearchUser) => item.id;

  // ─── Animation Styles ─────────────────────────────────────────────────────────
  // Use showFloatingSearch to control visibility so the animation plays out fully
  const browseAnimatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(searchProgress.get(), [0, 1], [1, 0]),
  }));

  const searchAnimatedStyle = useAnimatedStyle(() => ({
    opacity: searchProgress.get(),
  }));

  // Animate a fixed-size clipping layer and counter-scale its child. This
  // preserves the original moving/shrinking bar without changing Yoga width
  // or distorting the search text.
  const floatingSearchTransitionStyle = useAnimatedStyle(() => {
    "worklet";
    const baseY = searchBarY.get() || searchModeY;
    const progress = searchProgress.get();
    const startTranslateY = baseY - searchModeY;
    const scaleX = 1 + progress * (SEARCH_END_WIDTH / SEARCH_START_WIDTH - 1);

    return {
      // Keep the clone visible at progress 0 until React atomically swaps it
      // for the inline Home search bar after the exit animation.
      opacity: progress < 1 ? 1 : 0,
      borderRadius: SEARCH_BAR_HEIGHT / 2 / scaleX,
      transform: [
        { translateX: progress * BACK_BUTTON_OFFSET },
        { translateY: (1 - progress) * startTranslateY },
        { scaleX },
      ],
    };
  });

  const floatingSearchTransitionInnerStyle = useAnimatedStyle(() => {
    "worklet";
    const progress = searchProgress.get();
    const scaleX = 1 + progress * (SEARCH_END_WIDTH / SEARCH_START_WIDTH - 1);

    return { transform: [{ scaleX: 1 / scaleX }] };
  });

  const floatingSearchInputStyle = useAnimatedStyle(() => {
    "worklet";
    return { opacity: searchProgress.get() === 1 ? 1 : 0 };
  });

  // Back button scales in
  const backButtonAnimatedStyle = useAnimatedStyle(() => ({
    opacity: searchProgress.get(),
    transform: [{ scale: searchProgress.get() }],
  }));

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
      <Animated.View
        style={[styles.listContainer, browseAnimatedStyle]}
        pointerEvents={showFloatingSearch ? "none" : "auto"}
      >
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
              ItemSeparatorComponent={ActivitySeparator}
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
                  refreshing={isRefreshing && !isSearchActive}
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
            onNotificationPress={handleNotificationPress}
            unreadCount={unreadCount}
            isPro={isPro}
            titleOpacity={titleOpacity}
            avatarOpacity={avatarOpacity}
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

      {/* Search Mode */}
      <Animated.View
        style={[
          styles.listContainer,
          styles.searchModeContainer,
          searchAnimatedStyle,
        ]}
        pointerEvents={isSearchActive ? "auto" : "none"}
      >
        {/* Scrollable search results */}
        <FlatList
          ref={searchListRef}
          data={users}
          renderItem={renderUser}
          keyExtractor={searchKeyExtractor}
          ListHeaderComponent={SearchListHeader}
          ListEmptyComponent={renderSearchEmpty}
          ItemSeparatorComponent={SearchUserSeparator}
          onEndReachedThreshold={0.5}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing && isSearchActive}
              onRefresh={handleRefresh}
              enabled={isSearchActive}
              tintColor={theme.colors.primary}
              colors={[theme.colors.primary]}
              progressViewOffset={searchRefreshOffset}
            />
          }
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.searchResultsContent,
            { paddingBottom: listBottomPadding },
          ]}
        />
      </Animated.View>

      {/* Floating Search Bar (appears during transition and in search mode) */}
      {showFloatingSearch && (
        <>
          <Animated.View
            style={[
              styles.backButtonContainer,
              { top: searchModeY },
              backButtonAnimatedStyle,
            ]}
          >
            <ScalePressable
              onPress={handleExitSearch}
              style={styles.backButton}
              accessibilityRole="button"
              accessibilityLabel="Exit search"
            >
              <Ionicons name="arrow-back" size={24} style={styles.backIcon} />
            </ScalePressable>
          </Animated.View>

          <Animated.View
            style={[
              styles.floatingSearchTransition,
              floatingSearchTransitionStyle,
            ]}
            pointerEvents="none"
          >
            <Animated.View
              style={[
                styles.floatingSearchTransitionInner,
                floatingSearchTransitionInnerStyle,
              ]}
            >
              <SearchBar
                value={searchQuery}
                onChangeText={NOOP}
                placeholder="Search cooks..."
              />
            </Animated.View>
          </Animated.View>

          <Animated.View
            style={[styles.floatingSearchInput, floatingSearchInputStyle]}
            pointerEvents={isSearchActive ? "auto" : "none"}
          >
            <SearchBar
              ref={searchInputRef}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search cooks..."
            />
          </Animated.View>
        </>
      )}

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
  searchModeContainer: {
    backgroundColor: theme.colors.background,
  },
  searchResultsContent: {
    flexGrow: 1,
    paddingBottom: rt.insets.bottom,
  },
  searchListHeader: {
    paddingHorizontal: 20,
  },
  searchTitle: {
    textAlign: "left",
    letterSpacing: -1,
    paddingHorizontal: 2,
  },
  searchSubtitle: {
    paddingHorizontal: 2,
  },
  searchStateContainer: {
    paddingVertical: 40,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  searchStateText: {
    textAlign: "center",
  },
  feedContainer: {
    flex: 1,
  },
  feedContent: {
    paddingBottom: rt.insets.bottom,
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
  headerTitle: {},
  clubText: {
    color: theme.colors.primary,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  notificationButton: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: theme.colors.inputBackground,
    borderRadius: 22,
  },
  notificationIcon: {
    color: theme.colors.text,
  },
  searchContainer: {
    paddingHorizontal: 20,
  },
  searchBarHidden: {
    opacity: 0,
  },
  floatingSearchTransition: {
    position: "absolute",
    top: rt.insets.top,
    left: HORIZONTAL_PADDING,
    width: SEARCH_START_WIDTH,
    zIndex: 100,
    borderRadius: SEARCH_BAR_HEIGHT / 2,
    overflow: "hidden",
    transformOrigin: "left center",
  },
  floatingSearchTransitionInner: {
    width: SEARCH_START_WIDTH,
    transformOrigin: "left center",
  },
  floatingSearchInput: {
    position: "absolute",
    top: rt.insets.top,
    left: HORIZONTAL_PADDING + BACK_BUTTON_OFFSET,
    width: SEARCH_END_WIDTH,
    zIndex: 100,
  },
  backButtonContainer: {
    position: "absolute",
    left: HORIZONTAL_PADDING,
    zIndex: 101,
  },
  searchModeHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  backButton: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: theme.colors.inputBackground,
    borderRadius: 22,
  },
  backIcon: {
    color: theme.colors.text,
  },
  userRow: {
    paddingHorizontal: 20,
  },
  footerLoader: {
    paddingVertical: 20,
    alignItems: "center",
  },
  loadLatestContainer: {
    position: "absolute",
    top: rt.insets.top,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  loadLatestButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.primary,
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
