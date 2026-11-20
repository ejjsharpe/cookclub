import { memo } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import type { WeekDay } from "./week";

import { Text } from "@/components/Text";

const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const MAX_DOTS = 4;

interface WeekStripProps {
  days: WeekDay[];
  /** Number of planned meals per date string */
  mealCounts: Map<string, number>;
  selectedDate: string;
  onSelectDate: (dateString: string) => void;
}

/** Seven days with a dot per planned meal; tapping one jumps to that day. */
export const WeekStrip = memo(
  ({ days, mealCounts, selectedDate, onSelectDate }: WeekStripProps) => (
    <View style={styles.strip} accessibilityRole="tablist">
      {days.map((day) => {
        const selected = day.dateString === selectedDate;
        const count = mealCounts.get(day.dateString) ?? 0;
        return (
          <Pressable
            key={day.dateString}
            style={styles.day}
            onPress={() => onSelectDate(day.dateString)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={`${day.date.toDateString()}, ${count} ${
              count === 1 ? "meal" : "meals"
            } planned`}
          >
            <Text type="caption" style={styles.dow(day.isToday)}>
              {DOW[day.date.getDay()]}
            </Text>
            <View style={styles.numberCircle(selected, day.isToday)}>
              <Text
                type="headline"
                style={styles.number(selected, day.isToday)}
              >
                {day.date.getDate()}
              </Text>
            </View>
            <View style={styles.dots}>
              {Array.from({ length: Math.min(count, MAX_DOTS) }, (_, i) => (
                <View key={i} style={styles.dot} />
              ))}
            </View>
          </Pressable>
        );
      })}
    </View>
  ),
);

const styles = StyleSheet.create((theme) => ({
  strip: {
    flexDirection: "row",
  },
  day: {
    flex: 1,
    alignItems: "center",
    gap: 4,
    paddingVertical: 2,
  },
  dow: (isToday: boolean) => ({
    fontSize: 12,
    lineHeight: 15,
    fontFamily: theme.fonts.bold,
    color: isToday ? theme.colors.primary : theme.colors.textSecondary,
  }),
  numberCircle: (selected: boolean, isToday: boolean) => ({
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: selected
      ? isToday
        ? theme.colors.primary
        : theme.colors.text
      : "transparent",
  }),
  number: (selected: boolean, isToday: boolean) => ({
    fontFamily: theme.fonts.bold,
    color: selected
      ? theme.colors.background
      : isToday
        ? theme.colors.primary
        : theme.colors.text,
  }),
  dots: {
    flexDirection: "row",
    gap: 3,
    height: 5,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: theme.colors.border,
  },
}));
