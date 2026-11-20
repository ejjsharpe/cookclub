import { Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { GLASS_CONTROL_SIZE, GlassSurface } from "./Glass";

import { SystemIcon, type SystemIconProps } from "@/components/SystemIcon";

interface GlassCircleButtonProps {
  /** SF Symbol on iOS, with the closest Ionicon for Android. */
  icon: Pick<SystemIconProps, "sf" | "android">;
  accessibilityLabel: string;
  accessibilityHint?: string;
  onPress: () => void;
  disabled?: boolean;
}

/** A round glass button for toolbars that float over a screen. */
export const GlassCircleButton = ({
  icon,
  accessibilityLabel,
  accessibilityHint,
  onPress,
  disabled,
}: GlassCircleButtonProps) => {
  const { theme } = useUnistyles();
  return (
    <GlassSurface interactive style={styles.circle}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled }}
        disabled={disabled}
        hitSlop={4}
        onPress={onPress}
        style={({ pressed }) => [styles.hit, pressed && styles.pressed]}
      >
        <SystemIcon {...icon} size={20} color={theme.colors.text} />
      </Pressable>
    </GlassSurface>
  );
};

const styles = StyleSheet.create(() => ({
  circle: {
    width: GLASS_CONTROL_SIZE,
    height: GLASS_CONTROL_SIZE,
    borderRadius: GLASS_CONTROL_SIZE / 2,
  },
  hit: {
    width: GLASS_CONTROL_SIZE,
    height: GLASS_CONTROL_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.6,
  },
}));
