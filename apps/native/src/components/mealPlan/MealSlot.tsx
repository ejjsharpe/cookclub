import { Image } from "expo-image";
import { memo, useCallback } from "react";
import { Pressable, View } from "react-native";
import Swipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  interpolate,
  interpolateColor,
  Extrapolation,
  type SharedValue,
} from "react-native-reanimated";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useAnimatedTheme } from "react-native-unistyles/reanimated";

import { SystemIcon, type SystemIconProps } from "@/components/SystemIcon";
import { Text } from "@/components/Text";
import { getImageUrl } from "@/utils/imageUrl";

interface MealSlotProps {
  mealType: string;
  /** Shown above the recipe name, e.g. "Snack" or "Dinner · leftovers" */
  label?: string;
  entry?: {
    id: number;
    recipeId: number;
    recipeName: string;
    recipeImageUrl: string | null;
  };
  onPress: () => void;
  onDelete?: () => void;
  disabled?: boolean;
}

const MEAL_LABELS: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};

type Icon = Pick<SystemIconProps, "sf" | "android">;

const MEAL_ICONS: Partial<Record<string, Icon>> = {
  breakfast: { sf: "sun.max", android: "sunny-outline" },
  lunch: { sf: "cloud.sun", android: "partly-sunny-outline" },
  dinner: { sf: "moon", android: "moon-outline" },
};
const DEFAULT_ICON: Icon = { sf: "fork.knife", android: "restaurant-outline" };

const ProgressSyncer = ({
  source,
  target,
}: {
  source: SharedValue<number>;
  target: SharedValue<number>;
}) => {
  useAnimatedReaction(
    () => source.get(),
    (value) => {
      target.set(value);
    },
  );
  return null;
};

const DeleteAction = ({
  swipeProgress,
  onDelete,
}: {
  swipeProgress: SharedValue<number>;
  onDelete: () => void;
}) => {
  const deleteButtonStyle = useAnimatedStyle(() => {
    const scale = interpolate(swipeProgress.get(), [0.5, 0.7, 1], [0, 0.8, 1], {
      extrapolateLeft: Extrapolation.CLAMP,
      extrapolateRight: Extrapolation.CLAMP,
    });
    return {
      transform: [{ scale }],
      opacity: interpolate(swipeProgress.get(), [0.5, 0.6], [0, 1], {
        extrapolateLeft: Extrapolation.CLAMP,
        extrapolateRight: Extrapolation.CLAMP,
      }),
    };
  });

  return (
    <View style={styles.deleteActionContainer}>
      <Animated.View style={deleteButtonStyle}>
        <Pressable style={styles.deleteActionPill} onPress={onDelete}>
          <SystemIcon sf="trash" android="trash" size={18} color="#fff" />
        </Pressable>
      </Animated.View>
    </View>
  );
};

const SlotContent = ({
  mealType,
  label,
  entry,
  onPress,
  swipeProgress,
  disabled,
}: {
  mealType: string;
  label: string | undefined;
  entry: MealSlotProps["entry"];
  onPress: () => void;
  swipeProgress: SharedValue<number>;
  disabled: boolean;
}) => {
  const { theme } = useUnistyles();
  const animatedTheme = useAnimatedTheme();
  const recipeImageUrl = entry?.recipeImageUrl
    ? getImageUrl(entry.recipeImageUrl, "avatar-sm")
    : undefined;

  const backgroundStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      swipeProgress.get(),
      [0, 1],
      ["transparent", animatedTheme.get().colors.background],
    ),
  }));

  return (
    <Pressable style={styles.slot} onPress={onPress} disabled={disabled}>
      {({ pressed }) => (
        <>
          {pressed && (
            <View pointerEvents="none" style={styles.pressHighlight} />
          )}
          <Animated.View style={[styles.slotInner, backgroundStyle]}>
            {/* Left: Image or Icon container */}
            {entry ? (
              recipeImageUrl ? (
                <Image
                  source={{
                    uri: recipeImageUrl,
                  }}
                  style={styles.recipeImage}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              ) : (
                <View style={styles.iconContainer}>
                  <SystemIcon
                    {...DEFAULT_ICON}
                    size={18}
                    color={theme.colors.textSecondary}
                  />
                </View>
              )
            ) : (
              <View style={styles.iconContainer}>
                <SystemIcon
                  {...(MEAL_ICONS[mealType] ?? DEFAULT_ICON)}
                  size={18}
                  color={theme.colors.primary}
                />
              </View>
            )}

            {/* Center: Text content */}
            <View style={styles.textContainer}>
              <Text type="caption" style={styles.mealLabel}>
                {label ?? MEAL_LABELS[mealType] ?? mealType}
              </Text>
              {entry ? (
                <Text type="body" numberOfLines={1} style={styles.recipeName}>
                  {entry.recipeName}
                </Text>
              ) : (
                <Text type="bodyFaded">Add recipe</Text>
              )}
            </View>

            {/* Right: Chevron or Add icon */}
            {entry ? (
              <SystemIcon
                sf="chevron.right"
                android="chevron-forward"
                size={14}
                color={theme.colors.textSecondary}
              />
            ) : (
              <SystemIcon
                sf="plus.circle.fill"
                android="add-circle"
                size={22}
                color={theme.colors.primary}
              />
            )}
          </Animated.View>
        </>
      )}
    </Pressable>
  );
};

export const MealSlot = memo(function MealSlot({
  mealType,
  label,
  entry,
  onPress,
  onDelete,
  disabled = false,
}: MealSlotProps) {
  const swipeProgress = useSharedValue(0);

  const renderRightActions = useCallback(
    (progress: SharedValue<number>) => (
      <>
        <ProgressSyncer source={progress} target={swipeProgress} />
        <DeleteAction swipeProgress={progress} onDelete={() => onDelete?.()} />
      </>
    ),
    [onDelete, swipeProgress],
  );

  // Only make swipeable if there's an entry to delete and deletion is enabled
  if (!entry || !onDelete) {
    return (
      <SlotContent
        mealType={mealType}
        label={label}
        entry={entry}
        onPress={onPress}
        swipeProgress={swipeProgress}
        disabled={disabled}
      />
    );
  }

  return (
    <Swipeable
      renderRightActions={renderRightActions}
      overshootRight
      overshootLeft
      friction={2}
    >
      <SlotContent
        mealType={mealType}
        label={label}
        entry={entry}
        onPress={onPress}
        swipeProgress={swipeProgress}
        disabled={disabled}
      />
    </Swipeable>
  );
});

const styles = StyleSheet.create((theme) => ({
  slot: {
    minHeight: 72,
    position: "relative",
  },
  pressHighlight: {
    ...StyleSheet.absoluteFill,
    backgroundColor: theme.colors.pressHighlight,
  },
  slotInner: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 16,
  },
  recipeImage: {
    width: 40,
    height: 40,
    borderRadius: 10,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: theme.colors.primary + "15",
    justifyContent: "center",
    alignItems: "center",
  },
  textContainer: {
    flex: 1,
    gap: 2,
  },
  mealLabel: {
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.semiBold,
    fontSize: 13,
  },
  // The same weight and size as recipe names in lists elsewhere.
  recipeName: {
    fontFamily: theme.fonts.bold,
    fontSize: 16,
  },
  deleteActionContainer: {
    justifyContent: "center",
    alignItems: "center",
    paddingRight: 16,
  },
  deleteActionPill: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.destructive,
    justifyContent: "center",
    alignItems: "center",
  },
}));
