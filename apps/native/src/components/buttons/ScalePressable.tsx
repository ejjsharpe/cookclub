import { Pressable, type PressableProps } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type ScalePressableProps = PressableProps & {
  pressedScale?: number;
};

export const ScalePressable = ({
  pressedScale = 0.9,
  onPressIn,
  onPressOut,
  style,
  ...props
}: ScalePressableProps) => {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
  }));

  const handlePressIn: NonNullable<PressableProps["onPressIn"]> = (event) => {
    scale.set(withSpring(pressedScale, { mass: 1 }));
    onPressIn?.(event);
  };

  const handlePressOut: NonNullable<PressableProps["onPressOut"]> = (event) => {
    scale.set(withSpring(1));
    onPressOut?.(event);
  };

  return (
    <AnimatedPressable
      {...props}
      style={[style, animatedStyle]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
    />
  );
};
