import { memo } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { MealSlot } from "./MealSlot";
import type { WeekDay } from "./week";

import type { MealPlanEntry } from "@/api/mealPlan";
import { Ionicons } from "@/components/Ionicons";
import { Text } from "@/components/Text";
import { ScalePressable } from "@/components/buttons/ScalePressable";

export interface PlannedMeal {
  entry: MealPlanEntry;
  label: string;
}

interface DaySectionProps {
  day: WeekDay;
  title: string;
  meals: PlannedMeal[];
  canEdit: boolean;
  onAdd: (day: WeekDay) => void;
  onOpenMeal: (entry: MealPlanEntry) => void;
  onDeleteMeal: (entry: MealPlanEntry) => void;
  onLayout?: (dateString: string, event: LayoutChangeEvent) => void;
}

/** One day of the plan: its name with a round + to add, then what's planned. */
export const DaySection = memo(
  ({
    day,
    title,
    meals,
    canEdit,
    onAdd,
    onOpenMeal,
    onDeleteMeal,
    onLayout,
  }: DaySectionProps) => (
    <View
      style={styles.section(day.isPast)}
      onLayout={onLayout ? (e) => onLayout(day.dateString, e) : undefined}
    >
      <View style={styles.heading}>
        <Text type="title3" style={styles.title} numberOfLines={1}>
          {title}{" "}
          <Text type="title3" style={styles.dayNumber}>
            {day.date.getDate()}
          </Text>
        </Text>
        {canEdit && (
          <ScalePressable
            onPress={() => onAdd(day)}
            style={styles.addButton}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Add a meal to ${title}`}
          >
            <Ionicons name="add" size={20} style={styles.addIcon} />
          </ScalePressable>
        )}
      </View>

      {meals.length === 0 ? (
        <Text type="subheadline" style={styles.nothing}>
          Nothing planned
        </Text>
      ) : (
        meals.map(({ entry, label }, index) => (
          <View key={entry.id}>
            {index > 0 && <View style={styles.separator} />}
            <MealSlot
              mealType={entry.mealType}
              label={label}
              entry={entry}
              onPress={() => onOpenMeal(entry)}
              onDelete={canEdit ? () => onDeleteMeal(entry) : undefined}
            />
          </View>
        ))
      )}
    </View>
  ),
);

const styles = StyleSheet.create((theme) => ({
  section: (isPast: boolean) => ({
    paddingTop: 18,
    opacity: isPast ? 0.55 : 1,
  }),
  heading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 32,
    paddingHorizontal: 20,
    marginBottom: 2,
  },
  title: {
    flex: 1,
  },
  dayNumber: {
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.medium,
  },
  addButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  addIcon: {
    color: theme.colors.primary,
  },
  nothing: {
    color: theme.colors.textSecondary,
    opacity: 0.7,
    paddingHorizontal: 20,
    paddingTop: 2,
    paddingBottom: 4,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
    marginLeft: 72,
  },
}));
