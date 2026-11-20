import { Pressable } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Text } from "@/components/Text";

interface FilterChipProps {
  label: string;
  selected?: boolean;
  /** Shown faded after the label, e.g. how many recipes have a tag. */
  count?: number;
  onPress: () => void;
}

/** A toggle chip in the Filters sheet. */
export const FilterChip = ({
  label,
  selected = false,
  count,
  onPress,
}: FilterChipProps) => (
  <Pressable
    accessibilityRole="button"
    accessibilityState={{ selected }}
    accessibilityLabel={count == null ? label : `${label}, ${count} recipes`}
    onPress={onPress}
    style={({ pressed }) => [
      styles.chip,
      selected && styles.chipSelected,
      pressed && styles.pressed,
    ]}
  >
    <Text
      type="subheadline"
      style={[styles.label, selected && styles.labelSelected]}
    >
      {label}
    </Text>
    {count != null && (
      <Text
        type="footnote"
        style={[styles.count, selected && styles.labelSelected]}
      >
        {count}
      </Text>
    )}
  </Pressable>
);

const styles = StyleSheet.create((theme) => ({
  chip: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: theme.colors.inputBackground,
  },
  chipSelected: {
    backgroundColor: theme.colors.primary,
    backgroundImage: theme.colors.primaryGradient,
  },
  label: {
    fontFamily: theme.fonts.semiBold,
    color: theme.colors.text,
  },
  labelSelected: {
    color: theme.colors.buttonText,
  },
  count: {
    color: theme.colors.textSecondary,
  },
  pressed: {
    opacity: 0.7,
  },
}));
