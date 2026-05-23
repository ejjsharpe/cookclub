import { View, Pressable } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Ionicons } from "@/components/Ionicons";
import { VSpace } from "@/components/Space";
import { Text } from "@/components/Text";
import type { MeasurementSystem } from "@/lib/measurementPreferences";

interface Props {
  selected: MeasurementSystem;
  onSelect: (system: MeasurementSystem) => void;
}

const options: {
  value: MeasurementSystem;
  label: string;
  description: string;
}[] = [
  {
    value: "metric",
    label: "Metric",
    description: "g, ml, °C",
  },
  {
    value: "imperial",
    label: "Imperial",
    description: "oz, cups, °F",
  },
  {
    value: "auto",
    label: "Use recipe original",
    description: "Keeps the recipe's original units",
  },
];

function MeasurementOption({
  option,
  isSelected,
  onPress,
}: {
  option: (typeof options)[number];
  isSelected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
    >
      {({ pressed }) => (
        <View
          style={[styles.optionCard, isSelected && styles.optionCardSelected]}
        >
          {pressed && (
            <View pointerEvents="none" style={styles.pressHighlight} />
          )}
          <View style={styles.optionContent}>
            <Text
              type="headline"
              style={isSelected ? styles.optionLabelSelected : undefined}
            >
              {option.label}
            </Text>
            <Text type="subheadline" style={styles.optionDescription}>
              {option.description}
            </Text>
          </View>
          {isSelected && (
            <Ionicons
              name="checkmark-circle"
              size={22}
              style={styles.checkmark}
            />
          )}
        </View>
      )}
    </Pressable>
  );
}

export const OnboardingStepMeasurements = ({ selected, onSelect }: Props) => {
  return (
    <View style={styles.container}>
      <Text type="title2" style={styles.title}>
        Measurement units
      </Text>
      <VSpace size={6} />
      <Text type="bodyFaded" style={styles.subtitle}>
        How would you like to see measurements?
      </Text>
      <VSpace size={24} />

      <View style={styles.options}>
        {options.map((option) => (
          <MeasurementOption
            key={option.value}
            option={option}
            isSelected={selected === option.value}
            onPress={() => onSelect(option.value)}
          />
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
  },
  title: {
    textAlign: "left",
    letterSpacing: -1,
    paddingHorizontal: 2,
  },
  options: {
    gap: 12,
  },
  optionCard: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 68,
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: theme.borderRadius.medium,
    backgroundColor: theme.colors.inputBackground,
    position: "relative",
    overflow: "hidden",
  },
  optionCardSelected: {
    backgroundColor: theme.colors.primary + "10",
  },
  pressHighlight: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.pressHighlight,
  },
  optionContent: {
    flex: 1,
    gap: 2,
  },
  optionLabelSelected: {
    color: theme.colors.primary,
  },
  optionDescription: {
    color: theme.colors.textSecondary,
  },
  checkmark: {
    color: theme.colors.primary,
  },
}));
