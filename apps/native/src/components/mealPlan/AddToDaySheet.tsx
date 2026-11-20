import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Alert, Platform, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { MealTimeMenu } from "./MealTimeMenu";

import {
  useAddMealTime,
  useAddRecipeToMealPlan,
  type MealPlanEntry,
  type MealTime,
} from "@/api/mealPlan";
import {
  RecipeBrowserSheet,
  type RecipeBrowserSheetRef,
} from "@/components/RecipeBrowserSheet";
import { SystemIcon } from "@/components/SystemIcon";
import { Text } from "@/components/Text";

export interface AddToDayTarget {
  dateString: string;
  /** e.g. "Thursday 20" or "today" */
  label: string;
}

export interface AddToDaySheetRef {
  present: (target: AddToDayTarget) => void;
  dismiss: () => void;
}

interface AddToDaySheetProps {
  mealPlanId: number | undefined;
  mealTimes: MealTime[];
  /** Planned meals by date, kept live so the sheet sees others' changes */
  entriesByDate: Map<string, MealPlanEntry[]>;
  onEditMealTimes: () => void;
}

/** First free meal time; an empty day starts on dinner, which most people plan first. */
const pickDefaultMealTime = (
  visible: MealTime[],
  entries: MealPlanEntry[],
): string | undefined => {
  const taken = new Set(entries.map((e) => e.mealType));
  if (taken.size === 0 && visible.some((t) => t.key === "dinner")) {
    return "dinner";
  }
  return (visible.find((t) => !taken.has(t.key)) ?? visible[0])?.key;
};

/**
 * Add a recipe to one day. The meal time sits under the title as a menu, and
 * starts on the first free one.
 */
export const AddToDaySheet = forwardRef<AddToDaySheetRef, AddToDaySheetProps>(
  ({ mealPlanId, mealTimes, entriesByDate, onEditMealTimes }, ref) => {
    const { theme } = useUnistyles();
    const browserRef = useRef<RecipeBrowserSheetRef>(null);
    const [target, setTarget] = useState<AddToDayTarget | null>(null);
    const [selectedKey, setSelectedKey] = useState<string | undefined>();

    const addRecipe = useAddRecipeToMealPlan();
    const addMealTime = useAddMealTime();

    const visible = useMemo(
      () => mealTimes.filter((t) => !t.hidden),
      [mealTimes],
    );

    useImperativeHandle(ref, () => ({
      present: (next) => {
        setTarget(next);
        setSelectedKey(
          pickDefaultMealTime(
            visible,
            entriesByDate.get(next.dateString) ?? [],
          ),
        );
        browserRef.current?.present();
      },
      dismiss: () => browserRef.current?.dismiss(),
    }));

    const dayEntries = useMemo(
      () => (target ? (entriesByDate.get(target.dateString) ?? []) : []),
      [entriesByDate, target],
    );

    const takenBy = useMemo(() => {
      const map = new Map<string, MealPlanEntry>();
      dayEntries.forEach((e) => map.set(e.mealType, e));
      return map;
    }, [dayEntries]);

    // If the picked meal time was hidden meanwhile, fall back to a visible one
    const effectiveKey = visible.some((t) => t.key === selectedKey)
      ? selectedKey
      : pickDefaultMealTime(visible, dayEntries);
    const selected = visible.find((t) => t.key === effectiveKey);
    const replacing = effectiveKey ? takenBy.get(effectiveKey) : undefined;

    const saveNewMealTime = useCallback(
      async (name: string | undefined) => {
        const trimmed = name?.trim();
        if (!mealPlanId || !trimmed) return;
        try {
          const { mealTime } = await addMealTime.mutateAsync({
            mealPlanId,
            name: trimmed.slice(0, 24),
          });
          setSelectedKey(mealTime.key);
        } catch {
          // Alert shown by the mutation
        }
      },
      [addMealTime, mealPlanId],
    );

    const handleNewMealTime = useCallback(() => {
      // Android has no text prompt; its meal times sheet can add one.
      if (Platform.OS !== "ios") {
        onEditMealTimes();
        return;
      }
      Alert.prompt(
        "New meal time",
        "For example Supper or Second breakfast.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Add", onPress: (name?: string) => saveNewMealTime(name) },
        ],
        "plain-text",
      );
    }, [onEditMealTimes, saveNewMealTime]);

    const handleSelectRecipe = useCallback(
      async (recipeId: number) => {
        if (!mealPlanId || !target) return;
        if (!effectiveKey) {
          // Every meal time is hidden; keep the sheet open so one can be made.
          Alert.alert(
            "Pick a meal time",
            "Add or show a meal time, then choose a recipe.",
          );
          throw new Error("No meal time");
        }
        await addRecipe.mutateAsync({
          mealPlanId,
          recipeId,
          date: target.dateString,
          mealType: effectiveKey,
        });
      },
      [addRecipe, mealPlanId, effectiveKey, target],
    );

    const menuOptions = useMemo(
      () =>
        visible.map((t) => ({
          key: t.key,
          name: t.name,
          planned: takenBy.get(t.key)?.recipeName,
        })),
      [takenBy, visible],
    );

    const subtitle = (
      <View style={styles.subtitle}>
        <MealTimeMenu
          options={menuOptions}
          selectedKey={effectiveKey}
          onSelect={setSelectedKey}
          onNew={handleNewMealTime}
          onEdit={onEditMealTimes}
          accessibilityLabel={`Meal: ${selected?.name ?? "none"}`}
        >
          <View style={styles.mealButton}>
            <Text type="subheadline" style={styles.mealText}>
              {selected?.name ?? "Pick a meal"}
            </Text>
            <SystemIcon
              sf="chevron.down"
              android="chevron-down"
              size={11}
              color={theme.colors.primary}
            />
          </View>
        </MealTimeMenu>
        {replacing ? (
          <Text type="footnote" numberOfLines={1} style={styles.replacing}>
            Replaces {replacing.recipeName}
          </Text>
        ) : null}
      </View>
    );

    return (
      <RecipeBrowserSheet
        ref={browserRef}
        title={target ? `Add to ${target.label}` : "Add a meal"}
        subtitle={subtitle}
        rowAccessibilityHint={
          selected
            ? `Adds it as ${selected.name.toLowerCase()}${target ? ` on ${target.label}` : ""}`
            : undefined
        }
        onSelectRecipe={handleSelectRecipe}
      />
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  subtitle: {
    alignItems: "center",
  },
  mealButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  mealText: {
    color: theme.colors.primary,
    fontFamily: theme.fonts.bold,
  },
  replacing: {
    color: theme.colors.textSecondary,
  },
}));
