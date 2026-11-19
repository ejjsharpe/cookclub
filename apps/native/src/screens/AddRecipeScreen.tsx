import { useCallback } from "react";
import {
  Pressable,
  View,
  ScrollView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";

import { Ionicons } from "@/components/Ionicons";
import { VSpace } from "@/components/Space";
import { Text } from "@/components/Text";
import { useAddRecipe } from "@/features/add-recipe/AddRecipeProvider";
import { ImportQueueList } from "@/features/add-recipe/ImportQueue";
import { useRecipeImport } from "@/features/recipe-import/RecipeImportProvider";
import { useSubscription } from "@/lib/subscription";

const HEADER_HEIGHT = 52;

const ActionRow = ({
  icon,
  label,
  subtitle,
  counterLabel,
  onPress,
  disabled,
  featured,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  subtitle: string;
  counterLabel?: string;
  onPress: () => void;
  disabled?: boolean;
  featured?: boolean;
}) => {
  const theme = UnistylesRuntime.getTheme();

  return (
    <Pressable
      style={[
        styles.row,
        disabled && styles.rowDisabled,
        featured && styles.rowFeatured,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      {({ pressed }) => (
        <>
          {pressed && !disabled && (
            <View pointerEvents="none" style={styles.pressHighlight} />
          )}
          <View
            style={[
              styles.iconContainer,
              featured && styles.iconContainerFeatured,
            ]}
          >
            <Ionicons name={icon} size={24} color={theme.colors.primary} />
          </View>
          <View style={styles.textContainer}>
            <View style={styles.labelRow}>
              <Text type="body" style={styles.actionLabel}>
                {label}
              </Text>
              {featured && (
                <View style={styles.badge}>
                  <Text type="caption" style={styles.badgeText}>
                    Recommended
                  </Text>
                </View>
              )}
            </View>
            <Text type="subheadline" style={styles.subtitle}>
              {subtitle}
            </Text>
          </View>
          <View
            style={[
              styles.rowTrailing,
              !counterLabel && styles.rowTrailingCentered,
            ]}
          >
            {counterLabel && (
              <View style={styles.counterBadge}>
                <Text type="caption" style={styles.counterBadgeText}>
                  {counterLabel}
                </Text>
              </View>
            )}
            <Ionicons name="chevron-forward" size={20} style={styles.chevron} />
          </View>
        </>
      )}
    </Pressable>
  );
};

export const AddRecipeScreen = () => {
  const insets = UnistylesRuntime.insets;
  const { actions } = useAddRecipe();
  const { imports: backgroundImports } = useRecipeImport();
  const { isPro, smartImportsRemaining, smartImportsLimit } = useSubscription();

  // Scroll tracking for header fade
  const titleOpacity = useSharedValue(1);

  const titleAnimatedStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.get(),
  }));

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = event.nativeEvent.contentOffset.y;
      const titleShouldHide = y > 5;
      titleOpacity.set(
        withTiming(titleShouldHide ? 0 : 1, {
          duration: 150,
        }),
      );
    },
    [titleOpacity],
  );

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >
        <VSpace size={insets.top + HEADER_HEIGHT + 8} />

        {backgroundImports.length > 0 && (
          <>
            <VSpace size={8} />
            <ImportQueueList />
            <VSpace size={24} />
          </>
        )}

        {/* Import Section */}
        <Text style={styles.sectionTitle}>Import</Text>
        <VSpace size={8} />
        <View style={styles.section}>
          <ActionRow
            icon="link"
            label="Basic import"
            subtitle="Import from URL. Works for most recipe websites."
            onPress={actions.basicImport}
          />
          <View style={styles.separator} />
          <ActionRow
            icon="sparkles"
            label="Smart import"
            subtitle="Use AI to import from URL's, social media, text or photos."
            counterLabel={
              isPro
                ? undefined
                : `${smartImportsRemaining ?? 0}/${smartImportsLimit ?? 5} left`
            }
            onPress={actions.smartImport}
            featured
          />
        </View>

        <VSpace size={24} />

        {/* AI Section */}
        <Text style={styles.sectionTitle}>AI Tools</Text>
        <VSpace size={8} />
        <View style={styles.section}>
          <ActionRow
            icon="restaurant"
            label="AI Chef"
            subtitle={
              isPro
                ? "Describe what you want and AI will create a recipe."
                : "cookclub Pro feature."
            }
            onPress={actions.aiChef}
          />
          <View style={styles.separator} />
          <ActionRow
            icon="sparkles"
            label="Personalise recipe"
            subtitle={
              isPro
                ? "Make it vegan, cheaper, healthier, kid-friendly, or meal-prep ready."
                : "cookclub Pro feature."
            }
            onPress={actions.personalise}
          />
        </View>

        <VSpace size={24} />

        {/* Manual Section */}
        <Text style={styles.sectionTitle}>Manual</Text>
        <VSpace size={8} />
        <View style={styles.section}>
          <ActionRow
            icon="create"
            label="Create from scratch"
            subtitle="Build your own recipe step by step."
            onPress={actions.createFromScratch}
          />
        </View>
      </ScrollView>

      {/* Fixed Header */}
      <View style={styles.fixedHeader}>
        <Animated.View style={titleAnimatedStyle}>
          <Text type="screenTitle">Add recipe</Text>
        </Animated.View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create((theme, rt) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  scrollView: {
    flex: 1,
  },
  container: {
    paddingBottom: rt.insets.bottom + 72,
  },
  fixedHeader: {
    position: "absolute",
    top: rt.insets.top,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
  },
  sectionTitle: {
    color: theme.colors.text,
    fontSize: 20,
    fontFamily: theme.fonts.semiBold,
    marginLeft: 24,
  },
  section: {
    marginHorizontal: 20,
    backgroundColor: theme.colors.inputBackground,
    borderRadius: theme.borderRadius.large,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 16,
    position: "relative",
  },
  pressHighlight: {
    ...StyleSheet.absoluteFill,
    backgroundColor: theme.colors.pressHighlight,
  },
  rowDisabled: {
    opacity: 0.5,
  },
  rowFeatured: {
    backgroundColor: theme.colors.inputBackground,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: theme.colors.primary + "15",
    justifyContent: "center",
    alignItems: "center",
  },
  iconContainerFeatured: {
    backgroundColor: theme.colors.primary + "25",
  },
  textContainer: {
    flex: 1,
    gap: 2,
  },
  rowTrailing: {
    alignSelf: "stretch",
    alignItems: "flex-end",
    justifyContent: "space-between",
    minWidth: 54,
  },
  rowTrailingCentered: {
    justifyContent: "center",
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  actionLabel: {
    fontFamily: theme.fonts.medium,
  },
  badge: {
    backgroundColor: theme.colors.primary,
    backgroundImage: theme.colors.primaryGradient,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: theme.borderRadius.full,
  },
  badgeText: {
    color: "white",
    fontWeight: "600",
  },
  counterBadge: {
    backgroundColor: theme.colors.background,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: theme.borderRadius.full,
  },
  counterBadgeText: {
    color: theme.colors.primary,
    fontFamily: theme.fonts.semiBold,
    fontVariant: ["tabular-nums"],
  },
  subtitle: {
    color: theme.colors.textSecondary,
  },
  chevron: {
    color: theme.colors.textTertiary,
  },
  separator: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginLeft: 72,
  },
}));
