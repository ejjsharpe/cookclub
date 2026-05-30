import { memo } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Ionicons } from "@/components/Ionicons";
import { Text } from "@/components/Text";

interface ProBadgeProps {
  size?: "regular" | "compact";
  variant?: "subtle" | "solid";
  showLabel?: boolean;
  style?: StyleProp<ViewStyle>;
}

export const ProBadge = memo(function ProBadge({
  size = "regular",
  variant = "subtle",
  showLabel = true,
  style,
}: ProBadgeProps) {
  const isCompact = size === "compact";
  const isSolid = variant === "solid";

  return (
    <View
      accessible
      accessibilityLabel="Cook Club Pro"
      style={[
        styles.badge,
        isCompact ? styles.compactBadge : styles.regularBadge,
        isSolid ? styles.solidBadge : styles.subtleBadge,
        style,
      ]}
    >
      <Ionicons
        name="sparkles"
        size={isCompact ? 10 : 12}
        style={isSolid ? styles.solidIcon : styles.subtleIcon}
      />
      {showLabel && (
        <Text
          type="caption2"
          style={[
            styles.label,
            isCompact ? styles.compactLabel : styles.regularLabel,
            isSolid ? styles.solidLabel : styles.subtleLabel,
          ]}
        >
          Pro
        </Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
  },
  regularBadge: {
    height: 22,
    paddingHorizontal: 8,
    gap: 4,
  },
  compactBadge: {
    height: 18,
    paddingHorizontal: 6,
    gap: 3,
  },
  subtleBadge: {
    backgroundColor: theme.colors.primary + "14",
    borderColor: theme.colors.primary + "30",
  },
  solidBadge: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  subtleIcon: {
    color: theme.colors.primary,
  },
  solidIcon: {
    color: theme.colors.buttonText,
  },
  label: {
    fontFamily: theme.fonts.bold,
    letterSpacing: 0,
  },
  regularLabel: {
    fontSize: 12,
    lineHeight: 14,
  },
  compactLabel: {
    fontSize: 10,
    lineHeight: 12,
  },
  subtleLabel: {
    color: theme.colors.primary,
  },
  solidLabel: {
    color: theme.colors.buttonText,
  },
}));
