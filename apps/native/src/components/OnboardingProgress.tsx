import { View } from "react-native";
import Animated, {
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";

interface Props {
  currentStep: number;
  totalSteps: number;
}

const SPRING_CONFIG = { damping: 20, stiffness: 90, mass: 0.8 };
const BAR_HEIGHT = 4;

export const OnboardingProgress = ({ currentStep, totalSteps }: Props) => {
  const progress =
    totalSteps > 0
      ? Math.min(Math.max(currentStep, 0), totalSteps) / totalSteps
      : 0;

  const animatedFillStyle = useAnimatedStyle(() => ({
    width: withSpring(`${progress * 100}%`, SPRING_CONFIG),
  }));

  return (
    <View style={styles.container}>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, animatedFillStyle]} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create((theme) => ({
  container: {
    paddingHorizontal: 20,
  },
  track: {
    width: "100%",
    height: BAR_HEIGHT,
    backgroundColor: theme.colors.border,
    borderRadius: BAR_HEIGHT / 2,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    backgroundColor: theme.colors.primary,
    borderRadius: BAR_HEIGHT / 2,
  },
}));
