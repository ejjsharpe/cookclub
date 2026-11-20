import { isLiquidGlassAvailable } from "expo-glass-effect";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, type RefObject } from "react";
import {
  Pressable,
  TextInput,
  View,
  useWindowDimensions,
  type TextInputInstance,
} from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";

import { Ionicons } from "@/components/Ionicons";
import { SEARCH_BAR_HEIGHT } from "@/components/SearchBar";
import { Text } from "@/components/Text";
import { GlassSurface } from "@/components/glass/Glass";

export type RecipeSearchTab = "recipes" | "collections";

// Matches the Recipes screen and Home, so the field starts where the grey
// bar sits and the glass controls line up with every other screen.
const H_PAD = 20;
const CONTROL = 52;
const GAP = 8;
const TOP_GAP = 4;
const SWITCH_HEIGHT = 44;
const SWITCH_GAP = 12;

/**
 * Shared with the grey bar on the Recipes screen so the text doesn't change
 * as one becomes the other. Short enough to fit beside both glass buttons.
 */
export const RECIPE_SEARCH_PLACEHOLDER = "Search your library";

/** Height of the fixed glass header below the safe area. */
export const RECIPE_SEARCH_HEADER_HEIGHT =
  TOP_GAP + CONTROL + SWITCH_GAP + SWITCH_HEIGHT + 12;

// Without Liquid Glass the field keeps the grey fill rather than a blur.
const HAS_LIQUID_GLASS = isLiquidGlassAvailable();

const TAB_EASING = { duration: 250, easing: Easing.bezier(0.4, 0, 0.2, 1) };

interface RecipeSearchHeaderProps {
  /** 0 = the grey bar on the Recipes screen, 1 = open search. */
  progress: SharedValue<number>;
  /**
   * 1 for the last frame before search is removed. Glass shows a black frame
   * if it's torn down while visible, so it's hidden outright first.
   */
  tornDown: SharedValue<number>;
  /** Where the grey bar sits on screen, so the field grows out of it. */
  originY: number;
  open: boolean;
  tab: RecipeSearchTab;
  onTabChange: (tab: RecipeSearchTab) => void;
  query: string;
  onChangeQuery: (query: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  onOpenFilters: () => void;
  appliedCount: number;
  inputRef: RefObject<TextInputInstance | null>;
}

export const RecipeSearchHeader = ({
  progress,
  tornDown,
  originY,
  open,
  tab,
  onTabChange,
  query,
  onChangeQuery,
  onSubmit,
  onClose,
  onOpenFilters,
  appliedCount,
  inputRef,
}: RecipeSearchHeaderProps) => {
  const { width } = useWindowDimensions();
  const theme = UnistylesRuntime.getTheme();
  const insets = UnistylesRuntime.insets;
  const finalTop = insets.top + TOP_GAP;
  const showFilters = tab === "recipes";

  // 1 while the Filters button has a slot on the right.
  const filterSlot = useSharedValue(showFilters ? 1 : 0);
  useEffect(() => {
    filterSlot.set(withTiming(showFilters ? 1 : 0, TAB_EASING));
  }, [filterSlot, showFilters]);

  const tabIndex = useSharedValue(tab === "recipes" ? 0 : 1);
  useEffect(() => {
    tabIndex.set(withTiming(tab === "recipes" ? 0 : 1, TAB_EASING));
  }, [tabIndex, tab]);

  const fieldStyle = useAnimatedStyle(() => {
    const p = progress.get();
    const openLeft = H_PAD + CONTROL + GAP;
    const openWidth =
      width - openLeft - H_PAD - filterSlot.get() * (CONTROL + GAP);
    return {
      top: interpolate(p, [0, 1], [originY, finalTop]),
      left: interpolate(p, [0, 1], [H_PAD, openLeft]),
      width: interpolate(p, [0, 1], [width - H_PAD * 2, openWidth]),
      height: interpolate(p, [0, 1], [SEARCH_BAR_HEIGHT, CONTROL]),
    };
  });

  // The grey fill of the Recipes screen's bar fades as the glass arrives.
  const greyStyle = useAnimatedStyle(() => ({
    opacity: HAS_LIQUID_GLASS
      ? interpolate(progress.get(), [0, 0.6], [1, 0], "clamp")
      : 1,
  }));

  // Glass can't be faded with opacity (it just vanishes), so the switch only
  // slides here and materialises through GlassSurface's `hidden`.
  const switchStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.get()) * -12 }],
  }));

  const fadeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0.3, 1], [0, 1], "clamp"),
  }));

  const glassGate = useAnimatedStyle(() => ({
    opacity: tornDown.get() === 1 ? 0 : 1,
  }));

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: `${tabIndex.get() * 100}%` }],
  }));

  return (
    <View style={styles.container} pointerEvents="box-none">
      <Animated.View
        style={[
          styles.fade,
          { height: finalTop + RECIPE_SEARCH_HEADER_HEIGHT + 16 },
          fadeStyle,
        ]}
        pointerEvents="none"
      >
        <LinearGradient
          colors={[
            theme.colors.background,
            theme.colors.background,
            `${theme.colors.background}00`,
          ]}
          locations={[0, 0.7, 1]}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      <Animated.View
        style={[styles.side, { top: finalTop, left: H_PAD }, glassGate]}
        pointerEvents={open ? "auto" : "none"}
      >
        <GlassSurface
          interactive
          hidden={!open}
          style={styles.circle}
          contentStyle={styles.center}
        >
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close search"
            hitSlop={6}
            style={styles.center}
          >
            <Ionicons name="close" size={24} style={styles.icon} />
          </Pressable>
        </GlassSurface>
      </Animated.View>

      <Animated.View style={[styles.field, fieldStyle]}>
        <Animated.View style={[styles.grey, greyStyle]} />
        {HAS_LIQUID_GLASS && (
          <Animated.View
            style={[StyleSheet.absoluteFill, glassGate]}
            pointerEvents="none"
          >
            <GlassSurface
              hidden={!open}
              style={styles.fieldGlass}
              contentStyle={styles.fill}
            >
              <View />
            </GlassSurface>
          </Animated.View>
        )}
        <View style={styles.fieldContent}>
          <Ionicons name="search" size={20} style={styles.searchIcon} />
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={onChangeQuery}
            onSubmitEditing={onSubmit}
            placeholder={RECIPE_SEARCH_PLACEHOLDER}
            placeholderTextColor={theme.colors.placeholderText}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="never"
            style={styles.input}
          />
          {query.length > 0 && (
            <Pressable
              onPress={() => {
                onChangeQuery("");
                inputRef.current?.focus();
              }}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={10}
            >
              <Ionicons
                name="close-circle"
                size={18}
                style={styles.clearIcon}
              />
            </Pressable>
          )}
        </View>
      </Animated.View>

      <Animated.View
        style={[styles.side, { top: finalTop, right: H_PAD }, glassGate]}
        // Hidden on the Collections side, where the field runs underneath it.
        pointerEvents={open && showFilters ? "auto" : "none"}
        accessibilityElementsHidden={!open || !showFilters}
        importantForAccessibility={
          open && showFilters ? "auto" : "no-hide-descendants"
        }
      >
        <GlassSurface
          interactive
          hidden={!open || !showFilters}
          style={styles.circle}
          contentStyle={styles.center}
        >
          <Pressable
            onPress={onOpenFilters}
            accessibilityRole="button"
            accessibilityLabel={
              appliedCount > 0
                ? `Filter and sort, ${appliedCount} applied`
                : "Filter and sort"
            }
            hitSlop={6}
            style={styles.center}
          >
            <Ionicons
              name="options-outline"
              size={24}
              style={appliedCount > 0 ? styles.iconActive : styles.icon}
            />
          </Pressable>
        </GlassSurface>
        {open && showFilters && appliedCount > 0 && (
          <View style={styles.badge} pointerEvents="none">
            <Text type="caption2" style={styles.badgeText}>
              {appliedCount}
            </Text>
          </View>
        )}
      </Animated.View>

      <Animated.View
        style={[
          styles.switchWrap,
          { top: finalTop + CONTROL + SWITCH_GAP },
          switchStyle,
          glassGate,
        ]}
        pointerEvents={open ? "box-none" : "none"}
      >
        <GlassSurface
          hidden={!open}
          style={styles.switch}
          contentStyle={styles.switchRow}
        >
          <View style={styles.thumbTrack} pointerEvents="none">
            <Animated.View style={[styles.thumb, thumbStyle]} />
          </View>
          {(["recipes", "collections"] as const).map((value) => (
            <Pressable
              key={value}
              onPress={() => onTabChange(value)}
              accessibilityRole="tab"
              accessibilityLabel={
                value === "recipes" ? "Recipes" : "Collections"
              }
              accessibilityState={{ selected: tab === value }}
              style={styles.segment}
            >
              <SegmentLabel
                label={value === "recipes" ? "Recipes" : "Collections"}
                index={value === "recipes" ? 0 : 1}
                tabIndex={tabIndex}
              />
            </Pressable>
          ))}
        </GlassSurface>
      </Animated.View>
    </View>
  );
};

/**
 * Fades from the dark label to a white one as the red pill slides under it,
 * so the text is never white on the glass mid-switch.
 */
const SegmentLabel = ({
  label,
  index,
  tabIndex,
}: {
  label: string;
  index: number;
  tabIndex: SharedValue<number>;
}) => {
  const onPill = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(1, Math.abs(tabIndex.get() - index)),
  }));
  const offPill = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.abs(tabIndex.get() - index)),
  }));

  return (
    <View>
      <Animated.View style={offPill}>
        <Text type="headline">{label}</Text>
      </Animated.View>
      <Animated.View style={[styles.segmentOverlay, onPill]}>
        <Text type="headline" style={styles.segmentTextOn}>
          {label}
        </Text>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create((theme) => ({
  container: {
    ...StyleSheet.absoluteFill,
    zIndex: 10,
  },
  fade: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
  side: {
    position: "absolute",
    width: CONTROL,
    height: CONTROL,
  },
  circle: {
    width: CONTROL,
    height: CONTROL,
    borderRadius: CONTROL / 2,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  fill: {
    flex: 1,
  },
  icon: {
    color: theme.colors.text,
  },
  iconActive: {
    color: theme.colors.primary,
  },
  badge: {
    position: "absolute",
    top: -3,
    right: -3,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
    backgroundImage: theme.colors.primaryGradient,
    borderWidth: 2,
    borderColor: theme.colors.background,
  },
  badgeText: {
    color: theme.colors.buttonText,
    fontFamily: theme.fonts.bold,
  },
  field: {
    position: "absolute",
    borderRadius: CONTROL / 2,
  },
  grey: {
    ...StyleSheet.absoluteFill,
    borderRadius: CONTROL / 2,
    backgroundColor: theme.colors.inputBackground,
  },
  fieldGlass: {
    ...StyleSheet.absoluteFill,
    borderRadius: CONTROL / 2,
  },
  fieldContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 16,
    paddingRight: 14,
    gap: 10,
  },
  // Same as SearchBar's icon, so nothing changes as the bar becomes glass.
  searchIcon: {
    color: theme.colors.textTertiary,
  },
  input: {
    flex: 1,
    height: "100%",
    fontSize: 17,
    letterSpacing: -0.4,
    fontFamily: theme.fonts.regular,
    color: theme.colors.text,
    paddingVertical: 0,
  },
  clearIcon: {
    color: theme.colors.textTertiary,
  },
  switchWrap: {
    position: "absolute",
    left: H_PAD,
    right: H_PAD,
    height: SWITCH_HEIGHT,
  },
  switch: {
    height: SWITCH_HEIGHT,
    borderRadius: SWITCH_HEIGHT / 2,
  },
  switchRow: {
    flex: 1,
    flexDirection: "row",
    padding: 4,
  },
  thumbTrack: {
    position: "absolute",
    top: 4,
    bottom: 4,
    left: 4,
    right: 4,
  },
  thumb: {
    width: "50%",
    height: "100%",
    borderRadius: (SWITCH_HEIGHT - 8) / 2,
    backgroundColor: theme.colors.primary,
    backgroundImage: theme.colors.primaryGradient,
  },
  segmentTextOn: {
    color: theme.colors.buttonText,
  },
  segmentOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  segment: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
}));
