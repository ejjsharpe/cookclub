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
  /** Defaults to the toolbar size. */
  size?: number;
}

/** A round glass button for toolbars that float over a screen. */
export const GlassCircleButton = ({
  icon,
  accessibilityLabel,
  accessibilityHint,
  onPress,
  disabled,
  size = GLASS_CONTROL_SIZE,
}: GlassCircleButtonProps) => {
  const { theme } = useUnistyles();
  const dimensions = { width: size, height: size, borderRadius: size / 2 };
  return (
    <GlassSurface interactive style={dimensions}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled }}
        disabled={disabled}
        hitSlop={4}
        onPress={onPress}
        style={({ pressed }) => [
          styles.hit,
          { width: size, height: size },
          pressed && styles.pressed,
        ]}
      >
        <SystemIcon {...icon} size={20} color={theme.colors.text} />
      </Pressable>
    </GlassSurface>
  );
};

const styles = StyleSheet.create(() => ({
  hit: {
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.6,
  },
}));
