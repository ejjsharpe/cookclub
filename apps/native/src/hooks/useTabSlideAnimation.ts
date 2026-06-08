import {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  Easing,
} from "react-native-reanimated";

const animationConfig = {
  duration: 250,
  easing: Easing.bezier(0.4, 0, 0.2, 1),
};

export function useTabSlideAnimation() {
  const slideProgress = useSharedValue(1);
  const slideDirection = useSharedValue(0);

  const triggerSlide = (direction: number) => {
    slideDirection.set(direction);
    slideProgress.set(0);
    slideProgress.set(withTiming(1, animationConfig));
  };

  const animatedStyle = useAnimatedStyle(() => {
    const slideDistance = 30;
    const translateX = interpolate(
      slideProgress.get(),
      [0, 1],
      [slideDistance * slideDirection.get(), 0],
    );
    const opacity = interpolate(slideProgress.get(), [0, 0.3, 1], [0, 0.5, 1]);

    return {
      transform: [{ translateX }],
      opacity,
    };
  });

  return {
    animatedStyle,
    triggerSlide,
  };
}
