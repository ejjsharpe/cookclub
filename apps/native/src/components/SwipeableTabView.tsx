import { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  withSpring,
  SharedValue,
} from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { scheduleOnRN } from "react-native-worklets";

const SPRING_CONFIG = {
  damping: 20,
  stiffness: 200,
  mass: 0.5,
};

const VELOCITY_THRESHOLD = 500;

interface SwipeableTabViewProps {
  activeIndex: number;
  onIndexChange: (index: number) => void;
  children: ReactNode[];
  containerWidth?: number;
  scrollProgress?: SharedValue<number>;
}

export const SwipeableTabView = ({
  activeIndex,
  onIndexChange,
  children,
  containerWidth,
  scrollProgress,
}: SwipeableTabViewProps) => {
  const { width: windowWidth } = useWindowDimensions();
  const effectiveContainerWidth = containerWidth ?? windowWidth;
  const swipeThreshold = effectiveContainerWidth * 0.2;
  const translateX = useSharedValue(-activeIndex * effectiveContainerWidth);
  const startX = useSharedValue(0);
  const tabCount = children.length;

  // Sync translateX and scrollProgress when activeIndex changes externally (e.g., tab press)
  useAnimatedReaction(
    () => ({ activeIndex, width: effectiveContainerWidth }),
    (current, previous) => {
      if (
        current.activeIndex === previous?.activeIndex &&
        current.width === previous?.width
      ) {
        return;
      }

      translateX.set(
        withSpring(-current.activeIndex * current.width, SPRING_CONFIG),
      );
      scrollProgress?.set(withSpring(current.activeIndex, SPRING_CONFIG));
    },
    [activeIndex, effectiveContainerWidth, scrollProgress],
  );

  const panGesture = Gesture.Pan()
    // Only activate for horizontal swipes, allow vertical scrolling to pass through
    .activeOffsetX([-10, 10])
    .failOffsetY([-10, 10])
    .onStart(() => {
      startX.set(translateX.get());
    })
    .onUpdate((event) => {
      const newTranslateX = startX.get() + event.translationX;
      // Clamp to prevent over-scrolling
      const minTranslate = -(tabCount - 1) * effectiveContainerWidth;
      const maxTranslate = 0;
      translateX.set(
        Math.max(minTranslate, Math.min(maxTranslate, newTranslateX)),
      );

      // Update scroll progress for synced tab bar animation
      if (scrollProgress) {
        scrollProgress.set(-translateX.get() / effectiveContainerWidth);
      }
    })
    .onEnd((event) => {
      const velocity = event.velocityX;
      const currentOffset = -translateX.get();
      const currentIndex = Math.round(currentOffset / effectiveContainerWidth);

      let newIndex = currentIndex;

      // Determine if we should change tabs based on velocity or distance
      if (Math.abs(velocity) > VELOCITY_THRESHOLD) {
        // Velocity-based: flick to change
        if (velocity > 0 && currentIndex > 0) {
          newIndex = currentIndex - 1;
        } else if (velocity < 0 && currentIndex < tabCount - 1) {
          newIndex = currentIndex + 1;
        }
      } else {
        // Distance-based: snap to nearest
        const distanceFromCurrent =
          currentOffset - currentIndex * effectiveContainerWidth;
        if (Math.abs(distanceFromCurrent) > swipeThreshold) {
          if (distanceFromCurrent > 0 && currentIndex < tabCount - 1) {
            newIndex = currentIndex + 1;
          } else if (distanceFromCurrent < 0 && currentIndex > 0) {
            newIndex = currentIndex - 1;
          }
        }
      }

      // Clamp newIndex
      newIndex = Math.max(0, Math.min(tabCount - 1, newIndex));

      // Animate to the new position
      translateX.set(
        withSpring(-newIndex * effectiveContainerWidth, SPRING_CONFIG),
      );

      // Animate scroll progress with spring
      if (scrollProgress) {
        scrollProgress.set(withSpring(newIndex, SPRING_CONFIG));
      }

      // Notify parent if index changed
      if (newIndex !== activeIndex) {
        scheduleOnRN(onIndexChange, newIndex);
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.get() }],
  }));

  return (
    <View style={styles.container}>
      <GestureDetector gesture={panGesture}>
        <Animated.View
          style={[
            styles.tabsContainer,
            { width: effectiveContainerWidth * tabCount },
            animatedStyle,
          ]}
        >
          {children.map((child, index) => (
            <View
              key={index}
              style={[styles.tabContent, { width: effectiveContainerWidth }]}
            >
              {child}
            </View>
          ))}
        </Animated.View>
      </GestureDetector>
    </View>
  );
};

const styles = StyleSheet.create(() => ({
  container: {
    flex: 1,
    overflow: "hidden",
  },
  tabsContainer: {
    flexDirection: "row",
    flex: 1,
  },
  tabContent: {
    flex: 1,
  },
}));
