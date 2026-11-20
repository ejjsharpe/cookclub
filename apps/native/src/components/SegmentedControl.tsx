import { useRef, useEffect, useMemo } from "react";
import { View, TouchableOpacity, LayoutChangeEvent } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  SharedValue,
  interpolate,
  useDerivedValue,
  interpolateColor,
} from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useAnimatedTheme } from "react-native-unistyles/reanimated";

import { Text } from "./Text";

// Animated tab text component
const AnimatedText = Animated.createAnimatedComponent(Text);

const AnimatedTabText = ({
  label,
  index,
  scrollProgress,
  activeIndex,
  totalTabs,
  compact,
}: {
  label: string;
  index: number;
  scrollProgress: SharedValue<number> | undefined;
  activeIndex: number;
  totalTabs: number;
  compact?: boolean;
}) => {
  const animatedTheme = useAnimatedTheme();
  // Create input range for all tabs
  const inputRange = Array.from({ length: totalTabs }, (_, i) => i);
  // Output range: this tab is active (1) at its index, inactive (0) at others
  const outputRange = inputRange.map((i) => (i === index ? 1 : 0));

  const animatedStyle = useAnimatedStyle(() => {
    if (scrollProgress) {
      const progress = interpolate(
        scrollProgress.get(),
        inputRange,
        outputRange,
        "clamp",
      );

      return {
        color: interpolateColor(
          progress,
          [0, 1],
          [
            animatedTheme.get().colors.textSecondary,
            animatedTheme.get().colors.text,
          ],
        ),
      };
    }
    // Fallback to static color when no scrollProgress
    return {
      color:
        index === activeIndex
          ? animatedTheme.get().colors.text
          : animatedTheme.get().colors.textSecondary,
    };
  });

  return (
    <AnimatedText
      type={compact ? "subheadline" : "body"}
      numberOfLines={1}
      style={[tabTextStyles.text, animatedStyle]}
    >
      {label}
    </AnimatedText>
  );
};

export interface TabOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: TabOption<T>[];
  /** Leave undefined to show no choice selected yet. */
  value: T | undefined;
  onValueChange: (value: T, direction: number) => void;
  scrollProgress?: SharedValue<number>;
  fullWidth?: boolean;
  /** Smaller text and padding, for three or more options across the screen. */
  compact?: boolean;
}

const SPRING_CONFIG = {
  damping: 20,
  stiffness: 200,
  mass: 0.5,
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  scrollProgress,
  fullWidth = false,
  compact = false,
}: SegmentedControlProps<T>) {
  const tabPositions = useRef<{ x: number; width: number }[]>([]);
  const indicatorX = useSharedValue(0);
  const indicatorWidth = useSharedValue(0);
  const isInitialized = useRef(false);
  const currentIndex = useRef(0);

  // Shared values for tab positions (for use in worklets)
  const tabXPositions = useSharedValue<number[]>([]);
  const tabWidths = useSharedValue<number[]>([]);

  const activeIndex = options.findIndex((opt) => opt.value === value);
  const inputRange = useMemo(() => options.map((_, index) => index), [options]);

  const handleTabLayout = (index: number, event: LayoutChangeEvent) => {
    const { x, width } = event.nativeEvent.layout;
    tabPositions.current[index] = { x, width };

    // Update shared values when all tabs are laid out
    if (tabPositions.current.length === options.length) {
      const allValid = tabPositions.current.every(
        (pos) => pos && pos.width > 0,
      );
      if (allValid) {
        tabXPositions.set(tabPositions.current.map((p) => p.x));
        tabWidths.set(tabPositions.current.map((p) => p.width));
      }
    }

    // Set initial position without animation when the active tab is laid out
    if (index === activeIndex && !isInitialized.current) {
      indicatorX.set(x);
      indicatorWidth.set(width);
      currentIndex.current = index;
      isInitialized.current = true;
    }
  };

  // Sync indicator position when value changes externally (e.g., from swipe completion)
  useEffect(() => {
    if (
      isInitialized.current &&
      activeIndex !== currentIndex.current &&
      !scrollProgress
    ) {
      const position = tabPositions.current[activeIndex];
      if (position) {
        indicatorX.set(withSpring(position.x, SPRING_CONFIG));
        indicatorWidth.set(withSpring(position.width, SPRING_CONFIG));
        currentIndex.current = activeIndex;
      }
    }
  }, [activeIndex, indicatorX, indicatorWidth, scrollProgress]);

  const handlePress = (optionValue: T, index: number) => {
    const position = tabPositions.current[index];
    if (position) {
      indicatorX.set(withSpring(position.x, SPRING_CONFIG));
      indicatorWidth.set(withSpring(position.width, SPRING_CONFIG));
    }

    const direction = index > currentIndex.current ? 1 : -1;
    currentIndex.current = index;
    // Started with nothing chosen: the indicator is placed now.
    isInitialized.current = true;

    onValueChange(optionValue, direction);
  };

  // Derived values for interpolated position when scrollProgress is provided
  const interpolatedX = useDerivedValue(() => {
    if (scrollProgress && tabXPositions.get().length >= 2) {
      return interpolate(
        scrollProgress.get(),
        inputRange,
        tabXPositions.get(),
        "clamp",
      );
    }
    return indicatorX.get();
  });

  const interpolatedWidth = useDerivedValue(() => {
    if (scrollProgress && tabWidths.get().length >= 2) {
      return interpolate(
        scrollProgress.get(),
        inputRange,
        tabWidths.get(),
        "clamp",
      );
    }
    return indicatorWidth.get();
  });

  // Animated indicator style
  const indicatorStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateX: interpolatedX.get() }],
      width: interpolatedWidth.get(),
    };
  });

  return (
    <View
      accessibilityRole="tablist"
      style={[styles.container, fullWidth && styles.containerFullWidth]}
    >
      <Animated.View style={[styles.indicator, indicatorStyle]} />
      {options.map((option, index) => (
        <TouchableOpacity
          key={option.value}
          style={[
            styles.tab,
            fullWidth && styles.tabFullWidth,
            compact && styles.tabCompact,
          ]}
          onPress={() => handlePress(option.value, index)}
          accessibilityRole="tab"
          accessibilityLabel={option.label}
          accessibilityState={{ selected: index === activeIndex }}
          onLayout={(e) => handleTabLayout(index, e)}
          activeOpacity={0.7}
        >
          <AnimatedTabText
            label={option.label}
            index={index}
            scrollProgress={scrollProgress}
            activeIndex={activeIndex}
            totalTabs={options.length}
            compact={compact}
          />
        </TouchableOpacity>
      ))}
    </View>
  );
}

const TAB_HEIGHT = 38;
const CONTAINER_PADDING = 3;

const styles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    position: "relative",
    backgroundColor: theme.colors.inputBackground,
    borderRadius: theme.borderRadius.full,
    padding: CONTAINER_PADDING,
  },
  containerFullWidth: {
    alignSelf: "stretch",
  },
  tab: {
    height: TAB_HEIGHT,
    justifyContent: "center",
    paddingHorizontal: 20,
    zIndex: 1,
  },
  tabCompact: {
    paddingHorizontal: 8,
  },
  tabFullWidth: {
    flex: 1,
    alignItems: "center",
  },
  indicator: {
    position: "absolute",
    top: CONTAINER_PADDING,
    bottom: CONTAINER_PADDING,
    backgroundColor: theme.colors.background,
    borderRadius: TAB_HEIGHT / 2,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
}));

const tabTextStyles = StyleSheet.create((theme) => ({
  text: {
    fontFamily: theme.fonts.semiBold,
  },
}));
