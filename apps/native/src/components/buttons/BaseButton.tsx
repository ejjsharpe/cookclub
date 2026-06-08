import { Pressable, PressableProps } from "react-native";
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface BaseButtonProps {
  children: React.ReactNode;
  onPress: PressableProps["onPress"];
  disabled?: boolean;
  style?: PressableProps["style"];
}

export function BaseButton({
  children,
  onPress,
  disabled,
  style,
}: BaseButtonProps) {
  const sv = useSharedValue(1);
  const animatedStyles = useAnimatedStyle(() => {
    return {
      transform: [{ scale: sv.get() }],
      opacity: interpolate(sv.get(), [0.97, 1], [0.7, 1]),
    };
  });

  const onPressIn = () => {
    sv.set(
      withSpring(0.97, {
        damping: 8,
        stiffness: 100,
        mass: 0.4,
      }),
    );
  };

  const onPressOut = () => {
    sv.set(
      withSpring(1, {
        damping: 8,
        stiffness: 100,
        mass: 0.4,
      }),
    );
  };

  return (
    <AnimatedPressable
      disabled={disabled}
      style={[style, animatedStyles]}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onPress={onPress}
    >
      {children}
    </AnimatedPressable>
  );
}
