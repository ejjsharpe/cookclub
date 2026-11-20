import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

/** Extra fade below the status bar, covering a row of floating buttons. */
const FADE_BELOW_INSET = 80;

/**
 * Fades scrolled content out under the status bar and floating glass
 * buttons, so text never runs into the clock or sits behind the glass.
 */
export const TopScrollFade = () => {
  const { theme, rt } = useUnistyles();
  return (
    <LinearGradient
      pointerEvents="none"
      colors={[
        theme.colors.background,
        `${theme.colors.background}E6`,
        `${theme.colors.background}00`,
      ]}
      locations={[0, 0.62, 1]}
      style={[styles.fade, { height: rt.insets.top + FADE_BELOW_INSET }]}
    />
  );
};

const styles = StyleSheet.create({
  fade: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
});
