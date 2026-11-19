import { useEffect } from "react";
import { View, ViewStyle } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  interpolate,
  FadeIn as ReanimatedFadeIn,
  FadeOut as ReanimatedFadeOut,
} from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";

// ─── Fade In Component ───────────────────────────────────────────────────────

interface FadeInProps {
  children: React.ReactNode;
  duration?: number;
}

export const FadeIn = ({ children, duration = 300 }: FadeInProps) => {
  return (
    <Animated.View
      entering={ReanimatedFadeIn.duration(duration)}
      style={styles.fadeIn}
    >
      {children}
    </Animated.View>
  );
};

// ─── Skeleton Container Component ────────────────────────────────────────────

interface SkeletonContainerProps {
  isLoading: boolean;
  skeleton: React.ReactNode;
  children: React.ReactNode;
  duration?: number;
}

export const SkeletonContainer = ({
  isLoading,
  skeleton,
  children,
  duration = 300,
}: SkeletonContainerProps) => {
  return (
    <View style={styles.skeletonContainer}>
      {isLoading ? (
        <Animated.View
          key="skeleton"
          exiting={ReanimatedFadeOut.duration(duration)}
          style={styles.fadeIn}
        >
          {skeleton}
        </Animated.View>
      ) : (
        <Animated.View
          key="content"
          entering={ReanimatedFadeIn.duration(duration)}
          style={styles.fadeIn}
        >
          {children}
        </Animated.View>
      )}
    </View>
  );
};

interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export const Skeleton = ({
  width = "100%",
  height = 16,
  borderRadius = 4,
  style,
}: SkeletonProps) => {
  const shimmer = useSharedValue(0);

  useEffect(() => {
    shimmer.set(withRepeat(withTiming(1, { duration: 1200 }), -1, false));
  }, [shimmer]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(shimmer.get(), [0, 0.5, 1], [0.3, 0.6, 0.3]),
  }));

  return (
    <Animated.View
      style={[
        styles.skeleton,
        { width, height, borderRadius },
        animatedStyle,
        style,
      ]}
    />
  );
};

// Shared author line skeleton for feed cards
const ActivityUserHeaderSkeleton = () => (
  <View style={styles.userHeader}>
    <Skeleton width={36} height={36} borderRadius={18} />
    <Skeleton width={180} height={15} borderRadius={4} />
  </View>
);

// Like / comment row skeleton
const ActivityActionRowSkeleton = () => (
  <View style={styles.actionRow}>
    <Skeleton width={44} height={22} borderRadius={11} />
    <Skeleton width={44} height={22} borderRadius={11} />
  </View>
);

const FeedImageSkeleton = () => (
  <View style={styles.feedImage}>
    <Skeleton borderRadius={22} style={styles.fill} />
  </View>
);

// Saved recipe card: 4:3 photo, title, source
const ImportActivityCardSkeleton = () => (
  <View style={styles.card}>
    <ActivityUserHeaderSkeleton />
    <FeedImageSkeleton />
    <View style={styles.recipeInfo}>
      <Skeleton width="60%" height={18} borderRadius={4} />
      <Skeleton width={120} height={13} borderRadius={4} />
    </View>
    <ActivityActionRowSkeleton />
  </View>
);

// Review card: photo, stars, text, outlined recipe row
const ReviewActivityCardSkeleton = () => (
  <View style={styles.card}>
    <ActivityUserHeaderSkeleton />
    <FeedImageSkeleton />
    <Skeleton width={88} height={16} borderRadius={4} />
    <Skeleton width="85%" height={16} borderRadius={4} />
    <View style={styles.recipePreview}>
      <Skeleton width={48} height={48} borderRadius={12} />
      <View style={styles.recipeInfo}>
        <Skeleton width="65%" height={15} borderRadius={4} />
        <Skeleton width={80} height={13} borderRadius={4} />
      </View>
    </View>
    <ActivityActionRowSkeleton />
  </View>
);

export const HomeFeedSkeleton = () => {
  return (
    <View style={styles.feedSkeletonContainer}>
      <ImportActivityCardSkeleton />
      <View style={styles.feedSeparator} />
      <ReviewActivityCardSkeleton />
      <View style={styles.feedSeparator} />
      <ImportActivityCardSkeleton />
    </View>
  );
};

// ─── Recipe Card Skeleton ────────────────────────────────────────────────────

export const RecipeCardSkeleton = () => {
  return (
    <View style={styles.recipeCard}>
      <Skeleton width={100} height={100} borderRadius={12} />
      <View style={styles.recipeCardContent}>
        <Skeleton width="80%" height={17} borderRadius={4} />
        <View style={styles.recipeCardMeta}>
          <Skeleton width={70} height={14} borderRadius={4} />
          <Skeleton width={80} height={14} borderRadius={4} />
        </View>
      </View>
      <Skeleton width={20} height={20} borderRadius={4} />
    </View>
  );
};

export const MyRecipesListSkeleton = () => {
  return (
    <View>
      <RecipeCardSkeleton />
      <View style={styles.recipeSeparator}>
        <View style={styles.recipeSeparatorLine} />
      </View>
      <RecipeCardSkeleton />
      <View style={styles.recipeSeparator}>
        <View style={styles.recipeSeparatorLine} />
      </View>
      <RecipeCardSkeleton />
      <View style={styles.recipeSeparator}>
        <View style={styles.recipeSeparatorLine} />
      </View>
      <RecipeCardSkeleton />
    </View>
  );
};

// ─── Collection Card Skeleton ────────────────────────────────────────────────

const GRID_PADDING = 20;
const GRID_GAP = 12;

const CollectionGridCardSkeleton = () => {
  return (
    <View style={styles.collectionGridCard}>
      <Skeleton
        width="100%"
        height={100}
        borderRadius={12}
        style={styles.collectionGridImageSkeleton}
      />
      <View style={styles.collectionGridContent}>
        <Skeleton width="80%" height={17} borderRadius={4} />
        <Skeleton width={60} height={14} borderRadius={4} />
      </View>
    </View>
  );
};

export const CollectionsListSkeleton = () => {
  return (
    <View style={styles.collectionsGridContainer}>
      <View style={styles.collectionsGridRow}>
        <CollectionGridCardSkeleton />
        <CollectionGridCardSkeleton />
      </View>
      <View style={styles.collectionsGridRow}>
        <CollectionGridCardSkeleton />
        <CollectionGridCardSkeleton />
      </View>
    </View>
  );
};

// ─── Shopping List Skeleton ──────────────────────────────────────────────────

const ShoppingItemSkeleton = () => {
  return (
    <View style={styles.shoppingItemOuter}>
      <View style={styles.shoppingItemInner}>
        <View style={styles.shoppingCheckbox}>
          <Skeleton width={26} height={26} borderRadius={13} />
        </View>
        <View style={styles.shoppingItemContent}>
          <Skeleton width="70%" height={17} borderRadius={4} />
          <Skeleton width={120} height={13} borderRadius={4} />
        </View>
      </View>
    </View>
  );
};

export const ShoppingListSkeleton = () => {
  return (
    <View>
      {/* Section header */}
      <View style={styles.shoppingSectionHeader}>
        <Skeleton width={100} height={20} borderRadius={4} />
      </View>

      {/* Items */}
      <ShoppingItemSkeleton />
      <ShoppingItemSkeleton />
      <ShoppingItemSkeleton />

      {/* Another section */}
      <View style={styles.shoppingSectionHeader}>
        <Skeleton width={80} height={20} borderRadius={4} />
      </View>

      <ShoppingItemSkeleton />
      <ShoppingItemSkeleton />

      {/* Third section */}
      <View style={styles.shoppingSectionHeader}>
        <Skeleton width={60} height={20} borderRadius={4} />
      </View>

      <ShoppingItemSkeleton />
      <ShoppingItemSkeleton />
      <ShoppingItemSkeleton />
    </View>
  );
};

// ─── Meal Plan Skeleton ─────────────────────────────────────────────────────

const MealSlotSkeleton = () => (
  <View style={styles.mealSlotContainer}>
    {/* Recipe image placeholder */}
    <Skeleton width={40} height={40} borderRadius={10} />
    {/* Text stack */}
    <View style={styles.mealSlotContent}>
      <Skeleton width={60} height={12} borderRadius={4} />
      <Skeleton width="70%" height={17} borderRadius={4} />
    </View>
    {/* Chevron placeholder */}
    <Skeleton width={20} height={20} borderRadius={4} />
  </View>
);

const MealSlotSeparator = () => (
  <View style={styles.mealSlotSeparator}>
    <View style={styles.mealSlotSeparatorLine} />
  </View>
);

const DayGroupSkeleton = () => (
  <View>
    <MealSlotSkeleton />
    <MealSlotSeparator />
    <MealSlotSkeleton />
    <MealSlotSeparator />
    <MealSlotSkeleton />
  </View>
);

const DayHeaderSkeleton = ({
  showTodayBadge = false,
}: {
  showTodayBadge?: boolean;
}) => (
  <View style={styles.dayHeaderContainer}>
    <View style={styles.dayHeaderContent}>
      <Skeleton width={50} height={20} borderRadius={4} />
      <View style={styles.dayHeaderDateRow}>
        <Skeleton width={55} height={14} borderRadius={4} />
        {showTodayBadge && (
          <View style={styles.todayBadgeSkeleton}>
            <Skeleton width={40} height={18} borderRadius={9} />
          </View>
        )}
      </View>
    </View>
  </View>
);

const DayFooterSkeleton = () => <View style={styles.dayFooterSkeleton} />;

export const MealPlanSkeleton = () => (
  <View>
    {/* Day 1 */}
    <DayHeaderSkeleton showTodayBadge />
    <DayGroupSkeleton />
    <DayFooterSkeleton />

    {/* Day 2 */}
    <DayHeaderSkeleton />
    <DayGroupSkeleton />
    <DayFooterSkeleton />

    {/* Day 3 */}
    <DayHeaderSkeleton />
    <DayGroupSkeleton />
    <DayFooterSkeleton />

    {/* Day 4 */}
    <DayHeaderSkeleton />
    <DayGroupSkeleton />
    <DayFooterSkeleton />
  </View>
);

// ─── User Profile Skeleton ───────────────────────────────────────────────────

export const UserProfileSkeleton = () => {
  return (
    <View style={styles.userProfileContainer}>
      {/* Profile Header */}
      <View style={styles.userProfileHeader}>
        {/* Avatar */}
        <Skeleton width={100} height={100} borderRadius={50} />

        <View style={styles.userProfileSpacer16} />

        {/* Name */}
        <Skeleton width={160} height={28} borderRadius={6} />

        <View style={styles.userProfileSpacer8} />

        {/* Email */}
        <Skeleton width={200} height={17} borderRadius={4} />

        <View style={styles.userProfileSpacer8} />

        {/* Join date */}
        <Skeleton width={120} height={14} borderRadius={4} />

        <View style={styles.userProfileSpacer20} />

        {/* Stats */}
        <View style={styles.userProfileStats}>
          <View style={styles.userProfileStatItem}>
            <Skeleton width={40} height={24} borderRadius={4} />
            <Skeleton width={70} height={14} borderRadius={4} />
          </View>
          <View style={styles.userProfileStatItem}>
            <Skeleton width={40} height={24} borderRadius={4} />
            <Skeleton width={70} height={14} borderRadius={4} />
          </View>
          <View style={styles.userProfileStatItem}>
            <Skeleton width={40} height={24} borderRadius={4} />
            <Skeleton width={60} height={14} borderRadius={4} />
          </View>
        </View>
      </View>

      <View style={styles.userProfileSpacer24} />

      {/* Action Buttons */}
      <View style={styles.userProfileActions}>
        <Skeleton width="48%" height={50} borderRadius={25} />
        <Skeleton width="48%" height={50} borderRadius={25} />
      </View>

      <View style={styles.userProfileSpacer24} />

      {/* Activity Section Header */}
      <View style={styles.userProfileSectionHeader}>
        <Skeleton width={80} height={22} borderRadius={4} />
      </View>

      <View style={styles.userProfileSpacer12} />

      {/* Activity Cards */}
      <ImportActivityCardSkeleton />
      <View style={styles.feedSeparator} />
      <ReviewActivityCardSkeleton />
    </View>
  );
};

const styles = StyleSheet.create((theme) => ({
  fadeIn: {
    flex: 1,
  },
  skeletonContainer: {
    flex: 1,
  },
  skeleton: {
    backgroundColor: theme.colors.border,
  },
  card: {
    backgroundColor: theme.colors.background,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 12,
  },
  userHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  actionRow: {
    flexDirection: "row",
    gap: 20,
    paddingVertical: 11,
  },
  feedImage: {
    width: "100%",
    aspectRatio: 4 / 3,
  },
  fill: {
    ...StyleSheet.absoluteFillObject,
  },
  recipePreview: {
    flexDirection: "row",
    alignItems: "center",
    padding: 8,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: theme.colors.border,
    gap: 12,
  },
  recipeInfo: {
    flex: 1,
    gap: 4,
  },
  feedSkeletonContainer: {},
  feedSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
  },

  // Recipe Card styles
  recipeCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 20,
    gap: 14,
  },
  recipeCardContent: {
    flex: 1,
    gap: 8,
  },
  recipeCardMeta: {
    flexDirection: "row",
    gap: 12,
  },
  recipeSeparator: {
    paddingVertical: 8,
    paddingHorizontal: 20,
  },
  recipeSeparatorLine: {
    height: 1,
    backgroundColor: theme.colors.border,
    opacity: 0.5,
  },

  // Collections styles
  collectionGridCard: {
    flex: 1,
  },
  collectionGridImageSkeleton: {
    aspectRatio: 1,
    height: "auto",
  },
  collectionGridContent: {
    paddingTop: 8,
    gap: 4,
  },
  collectionsGridContainer: {
    paddingHorizontal: GRID_PADDING,
    gap: GRID_GAP,
  },
  collectionsGridRow: {
    flexDirection: "row",
    gap: GRID_GAP,
  },

  // Shopping List styles
  shoppingSectionHeader: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  shoppingItemOuter: {
    paddingHorizontal: 12,
    paddingVertical: 1,
  },
  shoppingItemInner: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 56,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  shoppingCheckbox: {
    marginRight: 14,
  },
  shoppingItemContent: {
    flex: 1,
    gap: 6,
  },

  // Meal Plan styles
  mealSlotContainer: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 16,
    height: 72,
  },
  mealSlotContent: {
    flex: 1,
    gap: 6,
  },
  mealSlotSeparator: {
    paddingLeft: 72,
    paddingRight: 20,
  },
  mealSlotSeparatorLine: {
    height: 1,
    backgroundColor: theme.colors.border,
    opacity: 0.5,
  },
  dayHeaderContainer: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    height: 56,
    justifyContent: "center",
  },
  dayHeaderContent: {
    gap: 4,
  },
  dayHeaderDateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  todayBadgeSkeleton: {
    marginLeft: 4,
  },
  dayFooterSkeleton: {
    height: 16,
  },

  // User Profile styles
  userProfileContainer: {
    paddingTop: 20,
  },
  userProfileHeader: {
    alignItems: "center",
    paddingHorizontal: 20,
  },
  userProfileSpacer8: {
    height: 8,
  },
  userProfileSpacer12: {
    height: 12,
  },
  userProfileSpacer16: {
    height: 16,
  },
  userProfileSpacer20: {
    height: 20,
  },
  userProfileSpacer24: {
    height: 24,
  },
  userProfileStats: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 40,
  },
  userProfileStatItem: {
    alignItems: "center",
    gap: 4,
  },
  userProfileActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
  },
  userProfileSectionHeader: {
    paddingHorizontal: 24,
  },
}));
