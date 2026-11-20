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
  Share,
  FlatList,
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
  useUnistyles,
  withUnistyles,
} from "react-native-unistyles";

import type {
  ActivityFeedListItem,
  CookingReviewFeedItem,
  RecipeImportFeedItem,
} from "@/api/activity";
import { useUserActivities } from "@/api/activity";
import { useUserProfile, useFollowUser, useUnfollowUser } from "@/api/follows";
import { useBlockUser } from "@/api/moderation";
import { useImportRecipe } from "@/api/recipe";
import { useUser } from "@/api/user";
import { ProBadge } from "@/components/ProBadge";
import {
  ReportContentSheet,
  type ReportContentSheetRef,
} from "@/components/ReportContentSheet";
import { SkeletonContainer, UserProfileSkeleton } from "@/components/Skeleton";
import { SystemIcon } from "@/components/SystemIcon";
import { Text } from "@/components/Text";
import { TopScrollFade } from "@/components/TopScrollFade";
import { PrimaryButton } from "@/components/buttons/PrimaryButton";
import { ScalePressable } from "@/components/buttons/ScalePressable";
import { GlassCircleButton } from "@/components/glass/GlassCircleButton";
import { CookedCard, SavedRow } from "@/features/profile/ProfileActivity";
import {
  createRecipeImportId,
  useRecipeImport,
} from "@/features/recipe-import/RecipeImportProvider";
import { useAvatarUpload } from "@/hooks/useAvatarUpload";
import { alertApiError } from "@/lib/apiErrorAlert";
import { openExternalWebsite } from "@/lib/externalBrowser";
import { useSessionContext } from "@/lib/sessionContext";
import { useSubscription } from "@/lib/subscription";
import type { RootStackParamList } from "@/navigation/navigationRef";
import { ensureMediaLibraryPermission } from "@/utils/imagePickerPermissions";
import { getImageUrl } from "@/utils/imageUrl";

type UserProfileScreenRoute = RouteProp<RootStackParamList, "UserProfile">;

const ThemedActivityIndicator = withUnistyles(ActivityIndicator, (theme) => ({
  color: theme.colors.primary,
}));
type CookedItem = CookingReviewFeedItem & ActivityFeedListItem;
type SavedItem = RecipeImportFeedItem & ActivityFeedListItem;

const ThemedFlashList = withUnistyles(FlashList<SavedItem>);
const HEADER_HEIGHT = 52;
const AVATAR_SIZE = 68;
const AVATAR_PREVIEW_SIZE = 220;
const AVATAR_PREVIEW_ACTION_GAP = 20;
const AVATAR_PREVIEW_ACTION_HEIGHT = 48;
const AVATAR_TRANSITION_DURATION = 240;

export const UserProfileScreen = () => {
  const route = useRoute<UserProfileScreenRoute>();
  const { theme } = useUnistyles();
  const navigation = useNavigation();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const { userId } = route.params;
  const importRecipeMutation = useImportRecipe();
  const { submitImport } = useRecipeImport();
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
  const currentUserId = currentUser?.user?.id ?? session?.user.id;
  const {
    upload: uploadAvatar,
    isUploading: isUploadingAvatar,
    progress: avatarUploadProgress,
  } = useAvatarUpload();

  // Reviews and saves page separately, so lots of one can't hold up the other.
  const cookedQuery = useUserActivities({ userId, type: "cooking_review" });
  const savedQuery = useUserActivities({ userId, type: "recipe_import" });

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

  const {
    fetchNextPage: fetchNextCooked,
    hasNextPage: hasMoreCooked,
    isFetchingNextPage: isFetchingNextCooked,
  } = cookedQuery;
  const handleLoadMoreCooked = useCallback(() => {
    if (hasMoreCooked && !isFetchingNextCooked) fetchNextCooked();
  }, [fetchNextCooked, hasMoreCooked, isFetchingNextCooked]);

  const {
    fetchNextPage: fetchNextSaved,
    hasNextPage: hasMoreSaved,
    isFetchingNextPage: isFetchingNextSaved,
  } = savedQuery;
  const handleLoadMoreSaved = useCallback(() => {
    if (hasMoreSaved && !isFetchingNextSaved) fetchNextSaved();
  }, [fetchNextSaved, hasMoreSaved, isFetchingNextSaved]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        refetchProfile(),
        cookedQuery.refetch(),
        savedQuery.refetch(),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  }, [cookedQuery, refetchProfile, savedQuery]);

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

  const handleRecipePress = useCallback(
    (recipeId: number) => {
      navigation.navigate("RecipeDetail", { recipeId });
    },
    [navigation],
  );

  const cookedItems = useMemo(
    () =>
      (cookedQuery.data ?? []).filter(
        (item): item is CookedItem => item.type === "cooking_review",
      ),
    [cookedQuery.data],
  );
  const savedItems = useMemo(
    () =>
      (savedQuery.data ?? []).filter(
        (item): item is SavedItem => item.type === "recipe_import",
      ),
    [savedQuery.data],
  );

  // Long-press on a saved recipe opens its post: likes, comments, report.
  const handleSavedOpenPost = useCallback(
    (item: SavedItem) => {
      navigation.navigate("Activity", {
        activityEventId: parseInt(item.id, 10),
      });
    },
    [navigation],
  );

  const handleCookedPress = useCallback(
    (item: CookedItem) => {
      navigation.navigate("Activity", {
        activityEventId: parseInt(item.id, 10),
      });
    },
    [navigation],
  );

  // Like the feed: recipes saved from a website always open that website,
  // so the original author gets the visit.
  const handleSavedPress = useCallback(
    (item: SavedItem) => {
      if (item.recipe.sourceType === "url") {
        openExternalWebsite(item.recipe.sourceUrl);
        return;
      }
      handleRecipePress(item.recipe.id);
    },
    [handleRecipePress],
  );

  // Same as the feed's add button: open it if it's already yours, else add it.
  const handleSavedSave = useCallback(
    (item: SavedItem) => {
      if (item.recipe.ownerId === currentUserId) {
        handleRecipePress(item.recipe.id);
      } else if (item.recipe.sourceType === "url") {
        handleImportRecipe(item.recipe.sourceUrl);
      } else {
        handleImportExistingRecipe(item.recipe.id);
      }
    },
    [
      currentUserId,
      handleImportExistingRecipe,
      handleImportRecipe,
      handleRecipePress,
    ],
  );

  const renderSavedItem = useCallback(
    ({ item }: ListRenderItemInfo<SavedItem>) => (
      <SavedRow
        item={item}
        onPress={handleSavedPress}
        onOpenPost={handleSavedOpenPost}
        saved={item.recipe.ownerId === currentUserId}
        onSave={isOwnProfile ? undefined : handleSavedSave}
      />
    ),
    [
      currentUserId,
      handleSavedOpenPost,
      handleSavedPress,
      handleSavedSave,
      isOwnProfile,
    ],
  );

  const renderEmpty = () => {
    if (cookedItems.length > 0) return null;
    if (cookedQuery.isLoading || savedQuery.isLoading) {
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
    if (isFetchingNextSaved) {
      return (
        <View style={styles.footer}>
          <ThemedActivityIndicator />
        </View>
      );
    }
    return null;
  };

  if (error) {
    return (
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <GlassCircleButton
            icon={{ sf: "chevron.backward", android: "chevron-back" }}
            accessibilityLabel="Go back"
            onPress={navigation.goBack}
          />
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
      <View>
        <View style={styles.identity}>
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
                    <Text type="title2" style={styles.avatarText}>
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
                <SystemIcon
                  sf="sparkles"
                  android="sparkles"
                  size={10}
                  color={theme.colors.buttonText}
                />
              </View>
            )}
          </View>
          <View style={styles.identityText}>
            <View style={styles.nameRow}>
              <Text type="title2" numberOfLines={2} style={styles.name}>
                {profile.user.name}
              </Text>
              {shouldShowProIndicators && <ProBadge variant="solid" />}
            </View>
            <Text type="subheadline" style={styles.muted} numberOfLines={1}>
              {[
                profile.user.username ? `@${profile.user.username}` : null,
                profile.followsMe && !isOwnProfile ? "Follows you" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </View>
        </View>

        <View style={styles.stats}>
          <Pressable
            onPress={() =>
              navigation.navigate("FollowsList", {
                userId,
                activeTab: "followers",
                userName: profile.user.name,
              })
            }
            accessibilityRole="button"
            hitSlop={8}
          >
            <Text type="subheadline" style={styles.muted}>
              <Text type="subheadline" style={styles.statNumber}>
                {followersCount}
              </Text>{" "}
              {followersCount === 1 ? "follower" : "followers"}
            </Text>
          </Pressable>
          <Pressable
            onPress={() =>
              navigation.navigate("FollowsList", {
                userId,
                activeTab: "following",
                userName: profile.user.name,
              })
            }
            accessibilityRole="button"
            hitSlop={8}
          >
            <Text type="subheadline" style={styles.muted}>
              <Text type="subheadline" style={styles.statNumber}>
                {profile.followingCount}
              </Text>{" "}
              following
            </Text>
          </Pressable>
          <Text type="subheadline" style={styles.muted}>
            <Text type="subheadline" style={styles.statNumber}>
              {profile.recipeCount}
            </Text>{" "}
            {profile.recipeCount === 1 ? "recipe" : "recipes"}
          </Text>
        </View>

        <View style={styles.actions}>
          {isOwnProfile ? (
            <ScalePressable
              style={styles.actionButton}
              onPress={() => navigation.navigate("Account")}
              accessibilityRole="button"
            >
              <Text type="headline">Edit profile</Text>
            </ScalePressable>
          ) : isFollowing ? (
            <ScalePressable
              style={styles.actionButton}
              onPress={handleUnfollow}
              accessibilityRole="button"
              accessibilityLabel={`Unfollow ${profile.user.name}`}
            >
              <SystemIcon
                sf="checkmark"
                android="checkmark"
                size={16}
                color={theme.colors.text}
              />
              <Text type="headline">Following</Text>
            </ScalePressable>
          ) : (
            <PrimaryButton onPress={handleFollow} style={styles.followButton}>
              Follow
            </PrimaryButton>
          )}
          <ScalePressable
            style={styles.shareButton}
            onPress={handleShareProfile}
            accessibilityRole="button"
            accessibilityLabel="Share profile"
          >
            <SystemIcon
              sf="square.and.arrow.up"
              android="share-social-outline"
              size={20}
              color={theme.colors.text}
            />
          </ScalePressable>
        </View>

        {cookedItems.length > 0 ? (
          <>
            <Text
              type="title3"
              style={styles.sectionTitle}
              accessibilityRole="header"
            >
              Cooked
            </Text>
            <FlatList
              horizontal
              data={cookedItems}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <CookedCard item={item} onPress={handleCookedPress} />
              )}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.shelf}
              onEndReached={handleLoadMoreCooked}
              onEndReachedThreshold={0.5}
              ListFooterComponent={
                isFetchingNextCooked ? (
                  <View style={styles.shelfLoading}>
                    <ThemedActivityIndicator />
                  </View>
                ) : undefined
              }
            />
          </>
        ) : null}

        {savedItems.length > 0 ? (
          <Text
            type="title3"
            style={styles.sectionTitle}
            accessibilityRole="header"
          >
            Saved
          </Text>
        ) : null}
      </View>
    );
  };

  const handleSettings = () => {
    navigation.navigate("Settings");
  };

  const refreshOffset = UnistylesRuntime.insets.top + HEADER_HEIGHT + 8;

  return (
    <View style={styles.container}>
      <BlurTargetView ref={profileBlurTargetRef} style={styles.container}>
        {/* Floating header */}
        <View style={styles.headerRow} pointerEvents="box-none">
          <GlassCircleButton
            icon={{ sf: "chevron.backward", android: "chevron-back" }}
            accessibilityLabel="Go back"
            onPress={navigation.goBack}
          />
          {profile ? (
            isOwnProfile ? (
              <GlassCircleButton
                icon={{ sf: "gearshape", android: "settings-outline" }}
                accessibilityLabel="Open settings"
                onPress={handleSettings}
              />
            ) : (
              <GlassCircleButton
                icon={{ sf: "ellipsis", android: "ellipsis-horizontal" }}
                accessibilityLabel="More profile options"
                accessibilityHint="Report or block this user"
                onPress={handleProfileOptions}
                disabled={blockMutation.isPending}
              />
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
            data={savedItems}
            renderItem={renderSavedItem}
            keyExtractor={(item) => item.id}
            ListHeaderComponent={renderHeader() ?? undefined}
            ListEmptyComponent={renderEmpty}
            ListFooterComponent={renderFooter}
            onEndReached={handleLoadMoreSaved}
            onEndReachedThreshold={0.5}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
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

        <TopScrollFade />

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
                <SystemIcon
                  sf="camera"
                  android="camera"
                  size={18}
                  color={theme.colors.buttonText}
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
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 20,
  },
  identityText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  avatarFrame: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarSourceHidden: {
    opacity: 0,
  },
  proAvatarFrame: {
    width: AVATAR_SIZE + 6,
    height: AVATAR_SIZE + 6,
    borderRadius: (AVATAR_SIZE + 6) / 2,
    borderWidth: 2,
    borderColor: theme.colors.primary + "70",
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    overflow: "hidden",
  },
  avatarImage: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarPlaceholder: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: theme.colors.primarySoft,
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
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  profileProSparkle: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: theme.colors.primary,
    backgroundImage: theme.colors.primaryGradient,
    borderWidth: 2,
    borderColor: theme.colors.background,
    justifyContent: "center",
    alignItems: "center",
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  name: {
    flexShrink: 1,
  },
  muted: {
    color: theme.colors.textSecondary,
  },
  stats: {
    flexDirection: "row",
    gap: 16,
    paddingHorizontal: 20,
    marginTop: 14,
  },
  statNumber: {
    color: theme.colors.text,
    fontFamily: theme.fonts.bold,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    marginTop: 18,
  },
  actionButton: {
    flex: 1,
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 22,
    backgroundColor: theme.colors.inputBackground,
  },
  followButton: {
    flex: 1,
    height: 44,
  },
  shareButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.inputBackground,
  },
  actionIcon: {
    color: theme.colors.text,
  },
  sectionTitle: {
    paddingHorizontal: 20,
    paddingTop: 30,
    paddingBottom: 12,
  },
  shelf: {
    paddingHorizontal: 20,
    gap: 12,
  },
  shelfLoading: {
    height: 126,
    justifyContent: "center",
    paddingHorizontal: 8,
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
  changeAvatarButtonText: {
    color: theme.colors.buttonText,
    fontSize: 16,
    fontFamily: theme.fonts.medium,
  },
}));
