import type { TrueSheet } from "@lodev09/react-native-true-sheet";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Pressable, Switch, TextInput, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Swipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { scheduleOnRN } from "react-native-worklets";

import {
  useAddMealTime,
  useChangeMealTime,
  type MealTime,
  type MealTimeChange,
} from "@/api/mealPlan";
import { AppSheet } from "@/components/AppSheet";
import { Ionicons } from "@/components/Ionicons";
import { Text } from "@/components/Text";

const ROW_HEIGHT = 56;
const DEFAULT_KEYS = new Set(["breakfast", "lunch", "dinner"]);

export interface MealTimesSheetRef {
  present: () => void;
  dismiss: () => void;
}

interface MealTimesSheetProps {
  mealPlanId: number | undefined;
  planName: string | undefined;
  mealTimes: MealTime[];
  isShared: boolean;
}

interface RowProps {
  mealTime: MealTime;
  index: number;
  count: number;
  onToggle: (key: string, on: boolean) => void;
  onMove: (from: number, by: number) => void;
  onDelete?: (key: string) => void;
}

const MealTimeRow = ({
  mealTime,
  index,
  count,
  onToggle,
  onMove,
  onDelete,
}: RowProps) => {
  const { theme } = useUnistyles();
  const dragY = useSharedValue(0);
  const dragging = useSharedValue(0);
  const on = !mealTime.hidden;

  // The row stays where it was dropped until it re-renders in its new slot.
  useEffect(() => {
    dragY.set(0);
  }, [index, dragY]);

  const handleDrop = useCallback(
    (by: number) => {
      onMove(index, by);
      // If the move fails the row stays at this index, so bring it back.
      setTimeout(() => dragY.set(withTiming(0)), 800);
    },
    [dragY, index, onMove],
  );

  // Drag by the grip; on release the row lands in the slot nearest where it
  // was dropped. Vertical only, so sideways swipes still reach swipe-to-delete.
  const pan = Gesture.Pan()
    .activeOffsetY([-8, 8])
    .failOffsetX([-12, 12])
    .onStart(() => {
      dragging.set(1);
    })
    .onUpdate((e) => {
      const min = -index * ROW_HEIGHT;
      const max = (count - 1 - index) * ROW_HEIGHT;
      dragY.set(Math.min(max, Math.max(min, e.translationY)));
    })
    .onEnd(() => {
      const by = Math.round(dragY.get() / ROW_HEIGHT);
      if (by !== 0) {
        scheduleOnRN(handleDrop, by);
      } else {
        dragY.set(withTiming(0));
      }
    })
    .onFinalize(() => {
      dragging.set(0);
    });

  const liftStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: dragY.get() },
      { scale: dragging.get() ? 1.02 : 1 },
    ],
    zIndex: dragging.get() ? 10 : 0,
    shadowOpacity: dragging.get() ? 0.18 : 0,
  }));

  const content = (
    <View style={styles.row}>
      <GestureDetector gesture={pan}>
        <View
          style={styles.grip}
          hitSlop={8}
          accessible
          accessibilityLabel={`Reorder ${mealTime.name}`}
          accessibilityValue={{ text: `${index + 1} of ${count}` }}
          accessibilityRole="adjustable"
          accessibilityActions={[
            { name: "increment", label: "Move up" },
            { name: "decrement", label: "Move down" },
          ]}
          // Swiping up (increment) moves it towards the top of the list
          onAccessibilityAction={(e) =>
            onMove(index, e.nativeEvent.actionName === "increment" ? -1 : 1)
          }
        >
          <Ionicons name="reorder-three" size={22} style={styles.gripIcon} />
        </View>
      </GestureDetector>
      <View style={styles.rowText}>
        <Text type="headline" style={styles.rowName(on)}>
          {mealTime.name}
        </Text>
        {mealTime.addedBy?.name ? (
          <Text type="caption">Added by {mealTime.addedBy.name}</Text>
        ) : null}
      </View>
      <View style={styles.switchWrap}>
        <Switch
          value={on}
          onValueChange={(value) => onToggle(mealTime.key, value)}
          trackColor={{ true: theme.colors.primary }}
          accessibilityLabel={`Show ${mealTime.name}`}
        />
      </View>
    </View>
  );

  return (
    <Animated.View style={[styles.rowShell, liftStyle]}>
      {onDelete ? (
        <Swipeable
          friction={2}
          rightThreshold={40}
          renderRightActions={() => (
            <Pressable
              style={styles.deleteAction}
              onPress={() => onDelete(mealTime.key)}
              accessibilityRole="button"
              accessibilityLabel={`Delete ${mealTime.name}`}
            >
              <Ionicons name="trash" size={20} color="#fff" />
            </Pressable>
          )}
        >
          {content}
        </Swipeable>
      ) : (
        content
      )}
      <View style={styles.separator} />
    </Animated.View>
  );
};

/** Reorder, hide and add the meal times every day of a plan can hold. */
export const MealTimesSheet = forwardRef<
  MealTimesSheetRef,
  MealTimesSheetProps
>(({ mealPlanId, planName, mealTimes, isShared }, ref) => {
  const { theme } = useUnistyles();
  const sheetRef = useRef<TrueSheet>(null);
  const [isNaming, setIsNaming] = useState(false);
  const [newName, setNewName] = useState("");
  const changeMealTime = useChangeMealTime();
  const addMealTime = useAddMealTime();

  useImperativeHandle(ref, () => ({
    present: () => {
      setIsNaming(false);
      setNewName("");
      sheetRef.current?.present();
    },
    dismiss: () => sheetRef.current?.dismiss(),
  }));

  const change = useCallback(
    (next: MealTimeChange) => {
      if (!mealPlanId) return;
      changeMealTime.mutate({ mealPlanId, change: next });
    },
    [mealPlanId, changeMealTime],
  );

  const handleToggle = useCallback(
    (key: string, on: boolean) => change({ type: on ? "show" : "hide", key }),
    [change],
  );

  const handleMove = useCallback(
    (from: number, by: number) => {
      const to = Math.max(0, Math.min(mealTimes.length - 1, from + by));
      const moved = mealTimes[from];
      if (to === from || !moved) return;
      const rest = mealTimes.filter((t) => t.key !== moved.key);
      // Name its new neighbour rather than an index, so the move still makes
      // sense if someone else changed the list meanwhile.
      change({
        type: "move",
        key: moved.key,
        beforeKey: rest[to]?.key ?? null,
      });
    },
    [mealTimes, change],
  );

  const handleDelete = useCallback(
    (key: string) => change({ type: "remove", key }),
    [change],
  );

  const handleAdd = useCallback(async () => {
    if (!mealPlanId || !newName.trim()) {
      setIsNaming(false);
      return;
    }
    try {
      await addMealTime.mutateAsync({ mealPlanId, name: newName.trim() });
      setNewName("");
      setIsNaming(false);
    } catch {
      // Alert shown by the mutation
    }
  }, [addMealTime, mealPlanId, newName]);

  return (
    <AppSheet
      ref={sheetRef}
      title="Meal times"
      detents={["auto"]}
      backgroundColor={theme.colors.background}
    >
      <View style={styles.body}>
        <Text type="subheadline" style={styles.intro}>
          The meals each day can hold, in this order.
          {isShared
            ? ` They're shared with everyone on ${planName ?? "this plan"}.`
            : ""}
        </Text>

        <View style={styles.card}>
          {mealTimes.map((t, i) => (
            <MealTimeRow
              key={t.key}
              mealTime={t}
              index={i}
              count={mealTimes.length}
              onToggle={handleToggle}
              onMove={handleMove}
              onDelete={DEFAULT_KEYS.has(t.key) ? undefined : handleDelete}
            />
          ))}

          {isNaming ? (
            <View style={styles.addRow}>
              <Ionicons name="add" size={20} style={styles.addIcon} />
              <TextInput
                value={newName}
                onChangeText={setNewName}
                placeholder="e.g. Supper"
                placeholderTextColor={theme.colors.placeholderText}
                autoFocus
                maxLength={24}
                returnKeyType="done"
                onSubmitEditing={handleAdd}
                onBlur={() => !newName.trim() && setIsNaming(false)}
                style={styles.addInput}
                accessibilityLabel="New meal time name"
              />
              <Pressable
                onPress={handleAdd}
                disabled={addMealTime.isPending}
                hitSlop={8}
                accessibilityRole="button"
              >
                <Text type="headline" style={styles.addText}>
                  Add
                </Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={styles.addRow}
              onPress={() => setIsNaming(true)}
              accessibilityRole="button"
            >
              <Ionicons name="add" size={20} style={styles.addIcon} />
              <Text type="headline" style={styles.addText}>
                Add a meal time
              </Text>
            </Pressable>
          )}
        </View>

        <Text type="footnote" style={styles.footer}>
          Drag to change the order. Switch one off to hide it when you add
          meals; anything already planned for it stays. Swipe left on your own
          meal times to delete them.
        </Text>
      </View>
    </AppSheet>
  );
});

const styles = StyleSheet.create((theme, rt) => ({
  body: {
    paddingHorizontal: 16,
    paddingBottom: rt.insets.bottom + 16,
    gap: 12,
  },
  intro: {
    color: theme.colors.textSecondary,
    paddingHorizontal: 4,
  },
  card: {
    borderRadius: 18,
    backgroundColor: theme.colors.inputBackground,
  },
  rowShell: {
    backgroundColor: theme.colors.inputBackground,
    borderRadius: 18,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 20,
  },
  row: {
    minHeight: ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 8,
    paddingRight: 12,
    backgroundColor: theme.colors.inputBackground,
    borderRadius: 18,
  },
  grip: {
    width: 32,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  gripIcon: {
    color: theme.colors.textSecondary,
  },
  rowText: {
    flex: 1,
    paddingVertical: 8,
  },
  switchWrap: {
    alignSelf: "stretch",
    justifyContent: "center",
  },
  rowName: (on: boolean) => ({
    fontFamily: theme.fonts.bold,
    color: on ? theme.colors.text : theme.colors.textSecondary,
  }),
  separator: {
    position: "absolute",
    left: 50,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
  },
  deleteAction: {
    width: 72,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.destructive,
    borderRadius: 18,
    marginLeft: 8,
  },
  addRow: {
    height: ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
  },
  addIcon: {
    color: theme.colors.primary,
  },
  addInput: {
    flex: 1,
    fontSize: 17,
    fontFamily: theme.fonts.bold,
    color: theme.colors.text,
    paddingVertical: 0,
  },
  addText: {
    color: theme.colors.primary,
    fontFamily: theme.fonts.bold,
  },
  footer: {
    color: theme.colors.textSecondary,
    paddingHorizontal: 4,
  },
}));
