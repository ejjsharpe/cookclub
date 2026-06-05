import { useRef } from "react";
import { View, TouchableOpacity, LayoutChangeEvent } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  SharedValue,
  interpolate,
  useDerivedValue,
  useAnimatedReaction,
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
}: {
  label: string;
  index: number;
  scrollProgress: SharedValue<number> | undefined;
  activeIndex: number;
  totalTabs: number;
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
            animatedTheme.value.colors.textSecondary,
            animatedTheme.value.colors.text,
          ],
        ),
      };
    }
    // Fallback to static color when no scrollProgress
    return {
      color:
        index === activeIndex
          ? animatedTheme.value.colors.text
          : animatedTheme.value.colors.textSecondary,
    };
  });

  return (
    <AnimatedText type="body" style={[tabTextStyles.text, animatedStyle]}>
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
  value: T;
  onValueChange: (value: T, direction: number) => void;
  scrollProgress?: SharedValue<number>;
  fullWidth?: boolean;
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
}: SegmentedControlProps<T>) {
  const tabPositions = useRef<{ x: number; width: number }[]>([]);
  const indicatorX = useSharedValue(0);
  const indicatorWidth = useSharedValue(0);
  const isInitialized = useRef(false);

  // Shared values for tab positions (for use in worklets)
  const tabXPositions = useSharedValue<number[]>([]);
  const tabWidths = useSharedValue<number[]>([]);

  const activeIndex = options.findIndex((opt) => opt.value === value);

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
      isInitialized.current = true;
    }
  };

  // Sync indicator position when value changes externally (e.g., from swipe completion)
  useAnimatedReaction(
    () => {
      const xPositions = tabXPositions.get();
      const widths = tabWidths.get();
      return {
        activeIndex,
        x: xPositions[activeIndex],
        width: widths[activeIndex],
        ready: xPositions.length === options.length,
      };
    },
    (current, previous) => {
      if (
        scrollProgress ||
        !current.ready ||
        current.x === undefined ||
        current.width === undefined ||
        current.activeIndex === previous?.activeIndex
      ) {
        return;
      }

      indicatorX.set(withSpring(current.x, SPRING_CONFIG));
      indicatorWidth.set(withSpring(current.width, SPRING_CONFIG));
    },
    [activeIndex, options.length, scrollProgress],
  );

  const handlePress = (optionValue: T, index: number) => {
    const position = tabPositions.current[index];
    if (position) {
      indicatorX.set(withSpring(position.x, SPRING_CONFIG));
      indicatorWidth.set(withSpring(position.width, SPRING_CONFIG));
    }

    const direction = index > activeIndex ? 1 : -1;

    onValueChange(optionValue, direction);
  };

  // Derived values for interpolated position when scrollProgress is provided
  const interpolatedX = useDerivedValue(() => {
    const xPositions = tabXPositions.get();
    if (scrollProgress && xPositions.length >= 2) {
      const inputRange = xPositions.map((_, i) => i);
      return interpolate(scrollProgress.get(), inputRange, xPositions, "clamp");
    }
    return indicatorX.get();
  });

  const interpolatedWidth = useDerivedValue(() => {
    const widths = tabWidths.get();
    if (scrollProgress && widths.length >= 2) {
      const inputRange = widths.map((_, i) => i);
      return interpolate(scrollProgress.get(), inputRange, widths, "clamp");
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
    <View style={[styles.container, fullWidth && styles.containerFullWidth]}>
      <Animated.View style={[styles.indicator, indicatorStyle]} />
      {options.map((option, index) => (
        <TouchableOpacity
          key={option.value}
          style={[styles.tab, fullWidth && styles.tabFullWidth]}
          onPress={() => handlePress(option.value, index)}
          onLayout={(e) => handleTabLayout(index, e)}
          activeOpacity={0.7}
        >
          <AnimatedTabText
            label={option.label}
            index={index}
            scrollProgress={scrollProgress}
            activeIndex={activeIndex}
            totalTabs={options.length}
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
