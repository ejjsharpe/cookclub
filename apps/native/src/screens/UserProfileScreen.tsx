import {
  useRoute,
  useNavigation,
  type RouteProp,
} from "@react-navigation/native";
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { BlurTargetView, BlurView } from "expo-blur";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import {
  ActionSheetIOS,
  View,
  ActivityIndicator,
  Alert,
  RefreshControl,
  type AlertButton,
  Modal,
  Pressable,
  TouchableOpacity,
  Share,
  useWindowDimensions,
  type ViewInstance,
} from "react-native";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import {
  StyleSheet,
  UnistylesRuntime,
  withUnistyles,
} from "react-native-unistyles";

import type {
  ActivityFeedListItem,
  CookingReviewFeedItem,
  RecipeImportFeedItem,
} from "@/api/activity";
import { useToggleActivityLike, useUserActivities } from "@/api/activity";
import { useUserProfile, useFollowUser, useUnfollowUser } from "@/api/follows";
import { useBlockUser } from "@/api/moderation";
import { useImportRecipe } from "@/api/recipe";
import { useUser } from "@/api/user";
import { ImportActivityCard } from "@/components/ImportActivityCard";
import { Ionicons } from "@/components/Ionicons";
import { ProBadge } from "@/components/ProBadge";
import {
  ReportContentSheet,
  type ReportContentSheetRef,
} from "@/components/ReportContentSheet";
import { ReviewActivityCard } from "@/components/ReviewActivityCard";
import { SkeletonContainer, UserProfileSkeleton } from "@/components/Skeleton";
import { VSpace } from "@/components/Space";
import { Text } from "@/components/Text";
import { BackButton } from "@/components/buttons/BackButton";
import { PrimaryButton } from "@/components/buttons/PrimaryButton";
import { ScalePressable } from "@/components/buttons/ScalePressable";
import {
  FEED_CARD_INSET,
  FeedSeparator,
} from "@/components/feed/FeedCardParts";
import { useAddRecipe } from "@/features/add-recipe/AddRecipeProvider";
import {
  createRecipeImportId,
  useRecipeImport,
} from "@/features/recipe-import/RecipeImportProvider";
import { useAvatarUpload } from "@/hooks/useAvatarUpload";
import { alertApiError } from "@/lib/apiErrorAlert";
import { useSessionContext } from "@/lib/sessionContext";
import { useSubscription } from "@/lib/subscription";
import type { RootStackParamList } from "@/navigation/navigationRef";
import { ensureMediaLibraryPermission } from "@/utils/imagePickerPermissions";
import { getImageUrl, selectFeedImagePreset } from "@/utils/imageUrl";

type UserProfileScreenRoute = RouteProp<RootStackParamList, "UserProfile">;

const ThemedActivityIndicator = withUnistyles(ActivityIndicator, (theme) => ({
  color: theme.colors.primary,
}));
const ThemedFlashList = withUnistyles(FlashList<ActivityFeedListItem>);
const HEADER_HEIGHT = 52;
const AVATAR_SIZE = 100;
const AVATAR_PREVIEW_SIZE = 220;
const AVATAR_PREVIEW_ACTION_GAP = 20;
const AVATAR_PREVIEW_ACTION_HEIGHT = 48;
const AVATAR_TRANSITION_DURATION = 240;

export const UserProfileScreen = () => {
  const route = useRoute<UserProfileScreenRoute>();
  const navigation = useNavigation();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const feedImageWidth = Math.max(windowWidth - FEED_CARD_INSET * 2, 1);
  const feedImagePreset = useMemo(
    () => selectFeedImagePreset(feedImageWidth),
    [feedImageWidth],
  );
  const { userId } = route.params;
  const importRecipeMutation = useImportRecipe();
  const { submitImport } = useRecipeImport();
  const { openAddMenu, notifyImportStarted } = useAddRecipe();
  const session = useSessionContext();
  const { requireSmartImport } = useSubscription();

  const reportSheetRef = useRef<ReportContentSheetRef>(null);
  const profileBlurTargetRef = useRef<ViewInstance>(null);
  const avatarRef = useRef<ViewInstance>(null);
  const isDismissingAvatarPreviewRef = useRef(false);
  const shouldChangeAvatarAfterDismissRef = useRef(false);
  const confirmedFollowingRef = useRef<boolean | null>(null);
  const desiredFollowingRef = useRef<boolean | null>(null);
  const isReconcilingFollowingRef = useRef(false);

  const [imageError, setImageError] = useState(false);
  const [isAvatarPreviewVisible, setIsAvatarPreviewVisible] = useState(false);
  const [isAvatarSourceHidden, setIsAvatarSourceHidden] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [optimisticFollowing, setOptimisticFollowing] = useState<
    boolean | null
  >(null);
  const avatarTransitionProgress = useSharedValue(0);
  const avatarOriginX = useSharedValue(0);
  const avatarOriginY = useSharedValue(0);
  const avatarOriginWidth = useSharedValue(AVATAR_SIZE);
  const avatarOriginHeight = useSharedValue(AVATAR_SIZE);

  const { data: currentUser } = useUser();
  const {
    data: profile,
    isLoading,
    error,
    refetch: refetchProfile,
  } = useUserProfile({ userId });
  const followMutation = useFollowUser();
  const unfollowMutation = useUnfollowUser();
  const blockMutation = useBlockUser();
  const toggleLike = useToggleActivityLike();
  const currentUserId = currentUser?.user?.id ?? session?.user.id;
  const {
    upload: uploadAvatar,
    isUploading: isUploadingAvatar,
    progress: avatarUploadProgress,
  } = useAvatarUpload();

  // Fetch user activities
  const {
    data: activities = [],
    fetchNextPage: fetchNextActivities,
    hasNextPage: hasMoreActivities,
    isFetchingNextPage: isFetchingNextActivities,
    isLoading: isLoadingActivities,
    refetch: refetchActivities,
  } = useUserActivities({ userId });

  const isOwnProfile = currentUserId === userId;
  const shouldShowProIndicators = profile?.user.subscriptionTier === "pro";
  const isFollowing = optimisticFollowing ?? profile?.isFollowing ?? false;
  const followersCount = Math.max(
    0,
    (profile?.followersCount ?? 0) +
      (optimisticFollowing !== null &&
      profile &&
      optimisticFollowing !== profile.isFollowing
        ? optimisticFollowing
          ? 1
          : -1
        : 0),
  );
  const avatarThumbnailUrl =
    getImageUrl(profile?.user.image, "avatar-lg") ??
    profile?.user.image ??
    undefined;
  const avatarPreviewUrl =
    getImageUrl(profile?.user.image, "detail_1600") ?? avatarThumbnailUrl;
  const avatarPreviewGroupHeight =
    AVATAR_PREVIEW_SIZE +
    (isOwnProfile
      ? AVATAR_PREVIEW_ACTION_GAP + AVATAR_PREVIEW_ACTION_HEIGHT
      : 0);
  const avatarPreviewTargetX = (windowWidth - AVATAR_PREVIEW_SIZE) / 2;
  const avatarPreviewTargetY = (windowHeight - avatarPreviewGroupHeight) / 2;

  const avatarPreviewAnimatedStyle = useAnimatedStyle(() => {
    const progress = avatarTransitionProgress.get();
    const targetCenterX = avatarPreviewTargetX + AVATAR_PREVIEW_SIZE / 2;
    const targetCenterY = avatarPreviewTargetY + AVATAR_PREVIEW_SIZE / 2;
    const originCenterX = avatarOriginX.get() + avatarOriginWidth.get() / 2;
    const originCenterY = avatarOriginY.get() + avatarOriginHeight.get() / 2;

    return {
      transform: [
        {
          translateX: interpolate(
            progress,
            [0, 1],
            [originCenterX - targetCenterX, 0],
            Extrapolation.CLAMP,
          ),
        },
        {
          translateY: interpolate(
            progress,
            [0, 1],
            [originCenterY - targetCenterY, 0],
            Extrapolation.CLAMP,
          ),
        },
        {
          scale: interpolate(
            progress,
            [0, 1],
            [avatarOriginWidth.get() / AVATAR_PREVIEW_SIZE, 1],
            Extrapolation.CLAMP,
          ),
        },
      ],
    };
  });

  const avatarPreviewBackdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: avatarTransitionProgress.get(),
  }));

  const avatarPreviewControlsAnimatedStyle = useAnimatedStyle(() => {
    const progress = avatarTransitionProgress.get();
    return {
      opacity: interpolate(progress, [0.55, 1], [0, 1], Extrapolation.CLAMP),
      transform: [
        {
          translateY: interpolate(
            progress,
            [0.55, 1],
            [8, 0],
            Extrapolation.CLAMP,
          ),
        },
      ],
    };
  });

  useEffect(() => {
    setImageError(false);
  }, [profile?.user.image]);

  useEffect(() => {
    if (!profile) return;
    if (isReconcilingFollowingRef.current) return;

    confirmedFollowingRef.current = profile.isFollowing;

    if (
      optimisticFollowing !== null &&
      optimisticFollowing === profile.isFollowing
    ) {
      desiredFollowingRef.current = profile.isFollowing;
      setOptimisticFollowing(null);
    } else if (optimisticFollowing === null) {
      desiredFollowingRef.current = profile.isFollowing;
    }
  }, [optimisticFollowing, profile]);

  const reconcileFollowing = useCallback(
    async (initialConfirmed: boolean) => {
      if (isReconcilingFollowingRef.current) return;

      isReconcilingFollowingRef.current = true;
      confirmedFollowingRef.current ??= initialConfirmed;

      try {
        while (
          desiredFollowingRef.current !== null &&
          desiredFollowingRef.current !== confirmedFollowingRef.current
        ) {
          const nextFollowing: boolean = desiredFollowingRef.current;

          try {
            if (nextFollowing) {
              await followMutation.mutateAsync({ userId });
            } else {
              await unfollowMutation.mutateAsync({ userId });
            }
            confirmedFollowingRef.current = nextFollowing;
          } catch (error) {
            desiredFollowingRef.current = confirmedFollowingRef.current;
            setOptimisticFollowing(null);
            alertApiError(
              nextFollowing ? "Follow Failed" : "Unfollow Failed",
              error,
              {
                operation: nextFollowing
                  ? "follows.followUser"
                  : "follows.unfollowUser",
                fallback: nextFollowing
                  ? "Could not follow this user. Please try again."
                  : "Could not unfollow this user. Please try again.",
              },
            );
            return;
          }
        }
      } finally {
        isReconcilingFollowingRef.current = false;
        if (desiredFollowingRef.current === confirmedFollowingRef.current) {
          setOptimisticFollowing(null);
        }
      }
    },
    [followMutation, unfollowMutation, userId],
  );

  const requestFollowing = useCallback(
    (nextFollowing: boolean) => {
      desiredFollowingRef.current = nextFollowing;
      setOptimisticFollowing(nextFollowing);
      reconcileFollowing(profile?.isFollowing ?? false);
    },
    [profile?.isFollowing, reconcileFollowing],
  );

  const handleFollow = useCallback(() => {
    requestFollowing(true);
  }, [requestFollowing]);

  const handleUnfollow = useCallback(() => {
    Alert.alert(
      "Unfollow User",
      `Are you sure you want to unfollow ${profile?.user.name}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unfollow",
          style: "destructive",
          onPress: () => {
            requestFollowing(false);
          },
        },
      ],
    );
  }, [profile?.user.name, requestFollowing]);

  const handleShareProfile = async () => {
    if (!profile) return;

    try {
      await Share.share({
        message: `Check out ${profile.user.name}'s profile on cookclub!`,
        url: `cookclub://profile/${userId}`,
      });
    } catch {
      // User cancelled or share failed - silent failure
    }
  };

  const handleReportUser = useCallback(() => {
    reportSheetRef.current?.present({ targetType: "user", targetId: userId });
  }, [userId]);

  const handleBlockUser = useCallback(
    (targetUserId = userId) => {
      Alert.alert(
        `Block ${profile?.user.name ?? "this user"}?`,
        "You will no longer see each other's profiles or content. Any follows in either direction will be removed.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Block",
            style: "destructive",
            onPress: async () => {
              try {
                await blockMutation.mutateAsync({ userId: targetUserId });
                navigation.goBack();
              } catch (error) {
                alertApiError("Block Failed", error, {
                  operation: "moderation.blockUser",
                  fallback: "Could not block this user. Please try again.",
                });
              }
            },
          },
        ],
      );
    },
    [blockMutation, navigation, profile?.user.name, userId],
  );

  const handleProfileOptions = useCallback(() => {
    const handleBlock = () => handleBlockUser();

    if (process.env.EXPO_OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: "Profile options",
          options: ["Report user", "Block user", "Cancel"],
          cancelButtonIndex: 2,
          destructiveButtonIndex: 1,
        },
        (buttonIndex) => {
          if (buttonIndex === 0) handleReportUser();
          if (buttonIndex === 1) handleBlock();
        },
      );
      return;
    }

    const buttons: AlertButton[] = [
      { text: "Report user", onPress: handleReportUser },
      { text: "Block user", style: "destructive", onPress: handleBlock },
      { text: "Cancel", style: "cancel" },
    ];
    Alert.alert("Profile options", undefined, buttons, { cancelable: true });
  }, [handleBlockUser, handleReportUser]);

  const handleLoadMoreActivities = useCallback(() => {
    if (hasMoreActivities && !isFetchingNextActivities) {
      fetchNextActivities();
    }
  }, [hasMoreActivities, isFetchingNextActivities, fetchNextActivities]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([refetchProfile(), refetchActivities()]);
    } finally {
      setIsRefreshing(false);
    }
  }, [refetchActivities, refetchProfile]);

  const pickAvatar = useCallback(async () => {
    const hasPermission = await ensureMediaLibraryPermission({
      message: "Please allow access to your photos to change your avatar.",
    });
    if (!hasPermission) return;

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        await uploadAvatar(result.assets[0].uri);
      }
    } catch (error) {
      alertApiError("Avatar Update Failed", error, {
        operation: "user.uploadAvatar",
        fallback: "Could not update your avatar. Please try again.",
      });
    }
  }, [uploadAvatar]);

  const finishAvatarPreviewDismissal = useCallback(() => {
    setIsAvatarSourceHidden(false);
    setIsAvatarPreviewVisible(false);
    isDismissingAvatarPreviewRef.current = false;

    if (shouldChangeAvatarAfterDismissRef.current) {
      shouldChangeAvatarAfterDismissRef.current = false;
      pickAvatar();
    }
  }, [pickAvatar]);

  const handleAvatarPreviewShown = useCallback(() => {
    setIsAvatarSourceHidden(true);
    avatarTransitionProgress.set(
      withTiming(1, {
        duration: AVATAR_TRANSITION_DURATION,
        easing: Easing.out(Easing.cubic),
      }),
    );
  }, [avatarTransitionProgress]);

  const handleCloseAvatarPreview = useCallback(() => {
    if (isDismissingAvatarPreviewRef.current) return;
    isDismissingAvatarPreviewRef.current = true;

    avatarTransitionProgress.set(
      withTiming(
        0,
        {
          duration: AVATAR_TRANSITION_DURATION,
          easing: Easing.inOut(Easing.cubic),
        },
        (finished) => {
          if (finished) {
            runOnJS(finishAvatarPreviewDismissal)();
          }
        },
      ),
    );
  }, [avatarTransitionProgress, finishAvatarPreviewDismissal]);

  const handleChangeAvatar = useCallback(() => {
    shouldChangeAvatarAfterDismissRef.current = true;
    handleCloseAvatarPreview();
  }, [handleCloseAvatarPreview]);

  const handleOpenAvatarPreview = useCallback(() => {
    avatarRef.current?.measureInWindow((x, y, width, height) => {
      avatarOriginX.set(x);
      avatarOriginY.set(y);
      avatarOriginWidth.set(width);
      avatarOriginHeight.set(height);
      avatarTransitionProgress.set(0);
      isDismissingAvatarPreviewRef.current = false;
      shouldChangeAvatarAfterDismissRef.current = false;
      setIsAvatarPreviewVisible(true);
    });
  }, [
    avatarOriginHeight,
    avatarOriginWidth,
    avatarOriginX,
    avatarOriginY,
    avatarTransitionProgress,
  ]);

  const sourceImportIdsRef = useRef(new Map<string, string>());

  const handleImportRecipe = useCallback(
    async (sourceUrl: string) => {
      try {
        const allowed = await requireSmartImport();
        if (!allowed) {
          openAddMenu();
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
        notifyImportStarted();
      } catch (error) {
        alertApiError("Import Failed", error, {
          operation: "recipeImport.create",
          fallback: "Unable to start this import. Please try again.",
        });
      }
    },
    [notifyImportStarted, openAddMenu, requireSmartImport, submitImport],
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

  const handleRecipePress = useCallback(
    (recipeId: number) => {
      navigation.navigate("RecipeDetail", { recipeId });
    },
    [navigation],
  );

  const handleUserPress = useCallback(
    (pressedUserId: string) => {
      navigation.navigate("UserProfile", { userId: pressedUserId });
    },
    [navigation],
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

  const renderActivityItem = useCallback(
    ({ item }: ListRenderItemInfo<ActivityFeedListItem>) => {
      if (item.type === "cooking_review") {
        return (
          <ReviewActivityCard
            activity={item satisfies CookingReviewFeedItem}
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
          activity={item satisfies RecipeImportFeedItem}
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
      handleImportRecipe,
      handleImportExistingRecipe,
      handleCommentPress,
      handleReportActivity,
      handleBlockUser,
      currentUserId,
      feedImagePreset,
      feedImageWidth,
    ],
  );

  const renderEmpty = () => {
    if (isLoadingActivities) {
      return (
        <View style={styles.emptyContainer}>
          <ThemedActivityIndicator size="large" />
        </View>
      );
    }

    return (
      <View style={styles.emptyContainer}>
        <Text type="bodyFaded">
          {isOwnProfile
            ? "No activity yet. Import recipes or write reviews to share!"
            : `${profile?.user.name} hasn't shared any activity yet`}
        </Text>
      </View>
    );
  };

  const renderFooter = () => {
    if (isFetchingNextActivities) {
      return (
        <View style={styles.footer}>
          <ThemedActivityIndicator />
        </View>
      );
    }
    return null;
  };

  const formatJoinDate = (date: string) => {
    return new Date(date).toLocaleDateString("en-GB", {
      year: "numeric",
      month: "long",
    });
  };

  if (error) {
    return (
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <BackButton />
        </View>
        <View style={styles.centered}>
          <Text type="bodyFaded">User not found</Text>
        </View>
      </View>
    );
  }

  const renderHeader = () => {
    if (!profile) return null;
    return (
      <View style={styles.headerContent}>
        {/* Profile Header */}
        <View style={styles.profileHeader}>
          <View
            style={[
              styles.avatarFrame,
              shouldShowProIndicators && styles.proAvatarFrame,
              isAvatarSourceHidden && styles.avatarSourceHidden,
            ]}
          >
            <View ref={avatarRef} collapsable={false} style={styles.avatar}>
              <Pressable
                style={styles.avatar}
                onPress={handleOpenAvatarPreview}
                disabled={isUploadingAvatar}
                accessibilityRole="imagebutton"
                accessibilityLabel={
                  isUploadingAvatar
                    ? `Uploading avatar, ${avatarUploadProgress}% complete`
                    : `${profile.user.name}'s avatar`
                }
                accessibilityHint="Opens a larger avatar preview"
                accessibilityState={{
                  busy: isUploadingAvatar,
                  disabled: isUploadingAvatar,
                }}
              >
                {avatarThumbnailUrl && !imageError ? (
                  <Image
                    source={{ uri: avatarThumbnailUrl }}
                    style={styles.avatarImage}
                    contentFit="cover"
                    onError={() => setImageError(true)}
                    cachePolicy="memory-disk"
                    transition={100}
                    accessible={false}
                  />
                ) : (
                  <View style={styles.avatarPlaceholder}>
                    <Text type="largeTitle" style={styles.avatarText}>
                      {profile.user.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                )}
                {isUploadingAvatar && (
                  <View style={styles.avatarUploadingOverlay}>
                    <ActivityIndicator size="small" color="#fff" />
                  </View>
                )}
              </Pressable>
            </View>
            {shouldShowProIndicators && (
              <View style={styles.profileProSparkle}>
                <Ionicons
                  name="sparkles"
                  size={14}
                  style={styles.profileProSparkleIcon}
                />
              </View>
            )}
          </View>

          <VSpace size={16} />

          <View style={styles.profileNameBlock}>
            <View style={styles.nameRow}>
              <Text type="title1" numberOfLines={2} style={styles.name}>
                {profile.user.name}
              </Text>
              {shouldShowProIndicators && (
                <ProBadge variant="solid" style={styles.profileProBadge} />
              )}
            </View>
          </View>

          {profile.user.username && (
            <Text type="bodyFaded" style={styles.username}>
              @{profile.user.username}
            </Text>
          )}

          <VSpace size={8} />

          <Text type="bodyFaded" style={styles.joinDate}>
            Joined {formatJoinDate(profile.user.createdAt)}
          </Text>

          <VSpace size={20} />

          {/* Stats */}
          <View style={styles.statsContainer}>
            <TouchableOpacity
              style={styles.statItem}
              onPress={() =>
                navigation.navigate("FollowsList", {
                  userId,
                  activeTab: "followers",
                  userName: profile.user.name,
                })
              }
              activeOpacity={0.7}
            >
              <Text type="heading" style={styles.statNumber}>
                {followersCount}
              </Text>
              <Text type="bodyFaded" style={styles.statLabel}>
                Followers
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.statItem}
              onPress={() =>
                navigation.navigate("FollowsList", {
                  userId,
                  activeTab: "following",
                  userName: profile.user.name,
                })
              }
              activeOpacity={0.7}
            >
              <Text type="heading" style={styles.statNumber}>
                {profile.followingCount}
              </Text>
              <Text type="bodyFaded" style={styles.statLabel}>
                Following
              </Text>
            </TouchableOpacity>
            <View style={styles.statItem}>
              <Text type="heading" style={styles.statNumber}>
                {profile.recipeCount}
              </Text>
              <Text type="bodyFaded" style={styles.statLabel}>
                Recipes
              </Text>
            </View>
          </View>
        </View>

        <VSpace size={24} />

        {/* Action Buttons */}
        {!isOwnProfile && (
          <View style={styles.actionButtons}>
            {isFollowing ? (
              <ScalePressable
                style={[styles.pillButton, styles.followingButton]}
                onPress={handleUnfollow}
                accessibilityRole="button"
                accessibilityLabel={`Unfollow ${profile.user.name}`}
              >
                <Ionicons
                  name="checkmark"
                  size={18}
                  style={styles.followingIcon}
                />
                <Text style={styles.followingButtonText}>Following</Text>
              </ScalePressable>
            ) : (
              <PrimaryButton onPress={handleFollow} style={styles.followButton}>
                Follow
              </PrimaryButton>
            )}
            <View style={styles.buttonSpacer} />
            <TouchableOpacity
              style={styles.pillButton}
              onPress={handleShareProfile}
              activeOpacity={0.7}
            >
              <Ionicons
                name="share-outline"
                size={18}
                style={styles.pillButtonIcon}
              />
              <Text style={styles.pillButtonText}>Share</Text>
            </TouchableOpacity>
          </View>
        )}

        {profile.followsMe && !isOwnProfile && (
          <>
            <VSpace size={12} />
            <View style={styles.followsYouBadge}>
              <Text type="caption" style={styles.followsYouText}>
                Follows you
              </Text>
            </View>
          </>
        )}

        <VSpace size={24} />

        {/* Activity Section Header */}
        <View style={styles.sectionHeader}>
          <Text type="heading">Activity</Text>
        </View>
        <VSpace size={12} />
      </View>
    );
  };

  const handleSettings = () => {
    navigation.navigate("Settings");
  };

  const theme = UnistylesRuntime.getTheme();
  const refreshOffset = UnistylesRuntime.insets.top + HEADER_HEIGHT + 8;

  return (
    <View style={styles.container}>
      <BlurTargetView ref={profileBlurTargetRef} style={styles.container}>
        {/* Floating header */}
        <View style={styles.headerRow}>
          <BackButton />
          {profile ? (
            isOwnProfile ? (
              <ScalePressable
                style={styles.headerButton}
                onPress={handleSettings}
                accessibilityRole="button"
                accessibilityLabel="Open settings"
              >
                <Ionicons
                  name="settings-outline"
                  size={22}
                  style={styles.headerIcon}
                />
              </ScalePressable>
            ) : (
              <ScalePressable
                style={styles.headerButton}
                onPress={handleProfileOptions}
                disabled={blockMutation.isPending}
                accessibilityRole="button"
                accessibilityLabel="More profile options"
                accessibilityHint="Report or block this user"
              >
                <Ionicons
                  name="ellipsis-horizontal"
                  size={22}
                  style={styles.headerIcon}
                />
              </ScalePressable>
            )
          ) : null}
        </View>

        <SkeletonContainer
          isLoading={isLoading || !profile}
          skeleton={
            <View style={styles.skeletonContent}>
              <UserProfileSkeleton />
            </View>
          }
        >
          <ThemedFlashList
            data={activities}
            renderItem={renderActivityItem}
            keyExtractor={(item) => item.id}
            ListHeaderComponent={renderHeader}
            ListEmptyComponent={renderEmpty}
            ListFooterComponent={renderFooter}
            onEndReached={handleLoadMoreActivities}
            onEndReachedThreshold={0.5}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={FeedSeparator}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={handleRefresh}
                tintColor={theme.colors.primary}
                colors={[theme.colors.primary]}
                progressViewOffset={refreshOffset}
              />
            }
          />
        </SkeletonContainer>

        <ReportContentSheet ref={reportSheetRef} />
      </BlurTargetView>

      <Modal
        visible={isAvatarPreviewVisible}
        transparent
        animationType="none"
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onShow={handleAvatarPreviewShown}
        onRequestClose={handleCloseAvatarPreview}
      >
        <View style={styles.avatarPreviewOverlay}>
          <Pressable
            style={styles.avatarPreviewBackdrop}
            onPress={handleCloseAvatarPreview}
            accessibilityRole="button"
            accessibilityLabel="Close avatar preview"
          >
            <Animated.View
              pointerEvents="none"
              style={[
                styles.avatarPreviewBackdropFill,
                avatarPreviewBackdropAnimatedStyle,
              ]}
            >
              <BlurView
                blurTarget={profileBlurTargetRef}
                blurMethod="dimezisBlurViewSdk31Plus"
                intensity={55}
                tint="systemUltraThinMaterialDark"
                style={styles.avatarPreviewBlur}
              />
              <View style={styles.avatarPreviewDimmer} />
            </Animated.View>
          </Pressable>

          <Animated.View
            style={[
              styles.avatarPreviewAnimatedAvatar,
              {
                left: avatarPreviewTargetX,
                top: avatarPreviewTargetY,
              },
              avatarPreviewAnimatedStyle,
            ]}
            accessible
            accessibilityRole="image"
            accessibilityLabel={`${profile?.user.name ?? "User"}'s avatar`}
          >
            {avatarThumbnailUrl && !imageError ? (
              <>
                <Image
                  source={{ uri: avatarThumbnailUrl }}
                  style={styles.avatarPreviewImage}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  accessible={false}
                />
                {avatarPreviewUrl &&
                  avatarPreviewUrl !== avatarThumbnailUrl && (
                    <Image
                      source={{ uri: avatarPreviewUrl }}
                      style={styles.avatarPreviewHighResolutionImage}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      transition={150}
                      accessible={false}
                    />
                  )}
              </>
            ) : (
              <View style={styles.avatarPreviewPlaceholder}>
                <Text type="largeTitle" style={styles.avatarPreviewText}>
                  {profile?.user.name.charAt(0).toUpperCase() ?? "?"}
                </Text>
              </View>
            )}
          </Animated.View>

          {isOwnProfile && (
            <Animated.View
              pointerEvents="box-none"
              style={[
                styles.avatarPreviewActions,
                {
                  top:
                    avatarPreviewTargetY +
                    AVATAR_PREVIEW_SIZE +
                    AVATAR_PREVIEW_ACTION_GAP,
                },
                avatarPreviewControlsAnimatedStyle,
              ]}
            >
              <ScalePressable
                style={styles.changeAvatarButton}
                onPress={handleChangeAvatar}
                accessibilityRole="button"
                accessibilityLabel="Change avatar"
              >
                <Ionicons
                  name="camera"
                  size={18}
                  style={styles.changeAvatarButtonIcon}
                />
                <Text style={styles.changeAvatarButtonText}>Change photo</Text>
              </ScalePressable>
            </Animated.View>
          )}
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create((theme, rt) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  headerRow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: rt.insets.top + 8,
    zIndex: 100,
  },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.inputBackground,
    justifyContent: "center",
    alignItems: "center",
  },
  headerIcon: {
    color: theme.colors.text,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  headerContent: {
    alignItems: "center",
    paddingTop: 20,
    paddingHorizontal: 20,
  },
  profileHeader: {
    alignItems: "center",
  },
  avatarFrame: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarSourceHidden: {
    opacity: 0,
  },
  proAvatarFrame: {
    width: 108,
    height: 108,
    borderRadius: 54,
    backgroundColor: theme.colors.primary + "14",
    borderWidth: 2,
    borderColor: theme.colors.primary + "70",
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    overflow: "hidden",
  },
  avatarImage: {
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: theme.colors.primary + "20",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: {
    color: theme.colors.primary,
  },
  avatarUploadingOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 50,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  profileProSparkle: {
    position: "absolute",
    right: 4,
    bottom: 4,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: theme.colors.primary,
    backgroundImage: theme.colors.primaryGradient,
    borderWidth: 3,
    borderColor: theme.colors.background,
    justifyContent: "center",
    alignItems: "center",
  },
  profileProSparkleIcon: {
    color: theme.colors.buttonText,
  },
  profileNameBlock: {
    alignItems: "center",
    maxWidth: "100%",
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    maxWidth: "100%",
  },
  name: {
    flexShrink: 1,
    textAlign: "center",
  },
  profileProBadge: {
    alignSelf: "center",
  },
  username: {
    textAlign: "center",
    marginTop: 4,
  },
  joinDate: {
    textAlign: "center",
    fontSize: 14,
  },
  statsContainer: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 40,
  },
  statItem: {
    alignItems: "center",
  },
  statNumber: {
    fontSize: 20,
  },
  statLabel: {
    fontSize: 14,
    marginTop: 2,
  },
  actionButtons: {
    flexDirection: "row",
    width: "100%",
  },
  pillButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 50,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.inputBackground,
    gap: 8,
  },
  pillButtonText: {
    fontSize: 16,
    fontWeight: "500",
    color: theme.colors.text,
  },
  pillButtonIcon: {
    color: theme.colors.text,
  },
  buttonSpacer: {
    width: 12,
  },
  followButton: {
    flex: 1,
  },
  followingButton: {
    backgroundColor: theme.colors.primary + "15",
  },
  followingButtonText: {
    fontSize: 16,
    fontWeight: "500",
    color: theme.colors.primary,
  },
  followingIcon: {
    color: theme.colors.primary,
  },
  followsYouBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.inputBackground,
  },
  followsYouText: {
    color: theme.colors.textSecondary,
  },
  sectionHeader: {
    width: "100%",
    paddingLeft: 4,
  },
  skeletonContent: {
    paddingTop: rt.insets.top + HEADER_HEIGHT + 8,
  },
  listContent: {
    paddingTop: rt.insets.top + HEADER_HEIGHT + 8,
    paddingBottom: rt.insets.bottom + 20,
  },
  emptyContainer: {
    paddingVertical: 40,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  footer: {
    paddingVertical: 20,
    alignItems: "center",
  },
  avatarPreviewOverlay: {
    flex: 1,
  },
  avatarPreviewBackdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  avatarPreviewBackdropFill: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  avatarPreviewBlur: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  avatarPreviewDimmer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(0, 0, 0, 0.48)",
  },
  avatarPreviewAnimatedAvatar: {
    position: "absolute",
    zIndex: 1,
    width: AVATAR_PREVIEW_SIZE,
    height: AVATAR_PREVIEW_SIZE,
    borderRadius: AVATAR_PREVIEW_SIZE / 2,
    overflow: "hidden",
    backgroundColor: theme.colors.primary + "20",
  },
  avatarPreviewImage: {
    width: "100%",
    height: "100%",
  },
  avatarPreviewHighResolutionImage: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  avatarPreviewPlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: theme.colors.primary + "20",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarPreviewText: {
    color: theme.colors.primary,
    fontSize: AVATAR_PREVIEW_SIZE * 0.36,
  },
  avatarPreviewActions: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 2,
    alignItems: "center",
  },
  changeAvatarButton: {
    width: 180,
    height: AVATAR_PREVIEW_ACTION_HEIGHT,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.primary,
    backgroundImage: theme.colors.primaryGradient,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  changeAvatarButtonIcon: {
    color: theme.colors.buttonText,
  },
  changeAvatarButtonText: {
    color: theme.colors.buttonText,
    fontSize: 16,
    fontFamily: theme.fonts.medium,
  },
}));
