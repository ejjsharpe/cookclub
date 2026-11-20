import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Pressable, TextInput, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import {
  useAddMealTime,
  useAddRecipeToMealPlan,
  type MealPlanEntry,
  type MealTime,
} from "@/api/mealPlan";
import { Ionicons } from "@/components/Ionicons";
import {
  RecipeBrowserSheet,
  type RecipeBrowserSheetRef,
} from "@/components/RecipeBrowserSheet";
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
 * Add a recipe to one day: pick the meal time (or make a new one), then a recipe.
 */
export const AddToDaySheet = forwardRef<AddToDaySheetRef, AddToDaySheetProps>(
  ({ mealPlanId, mealTimes, entriesByDate, onEditMealTimes }, ref) => {
    const { theme } = useUnistyles();
    const browserRef = useRef<RecipeBrowserSheetRef>(null);
    const [target, setTarget] = useState<AddToDayTarget | null>(null);
    const [selectedKey, setSelectedKey] = useState<string | undefined>();
    const [isNaming, setIsNaming] = useState(false);
    const [newName, setNewName] = useState("");

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
        setIsNaming(false);
        setNewName("");
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

    const handleSaveNew = useCallback(async () => {
      if (!mealPlanId || !newName.trim()) {
        setIsNaming(false);
        return;
      }
      try {
        const { mealTime } = await addMealTime.mutateAsync({
          mealPlanId,
          name: newName.trim(),
        });
        setSelectedKey(mealTime.key);
        setIsNaming(false);
        setNewName("");
      } catch {
        // Alert shown by the mutation
      }
    }, [addMealTime, mealPlanId, newName]);

    const handleSelectRecipe = useCallback(
      async (recipeId: number) => {
        if (!mealPlanId || !target || !effectiveKey) return;
        await addRecipe.mutateAsync({
          mealPlanId,
          recipeId,
          date: target.dateString,
          mealType: effectiveKey,
        });
      },
      [addRecipe, mealPlanId, effectiveKey, target],
    );

    const hint = !selected
      ? "Pick a meal time first."
      : replacing
        ? `This replaces ${replacing.recipeName}.`
        : `Tap a recipe to add it to ${target?.label ?? "this day"} as ${selected.name.toLowerCase()}.`;

    const topContent = (
      <View style={styles.top}>
        <View style={styles.labelRow}>
          <Text type="footnote" style={styles.label}>
            Meal
          </Text>
          <Pressable
            onPress={onEditMealTimes}
            hitSlop={8}
            accessibilityRole="button"
          >
            <Text type="subheadline" style={styles.link}>
              Edit meal times
            </Text>
          </Pressable>
        </View>

        <View style={styles.chips} accessibilityRole="radiogroup">
          {visible.map((t) => {
            const on = t.key === effectiveKey;
            return (
              <Pressable
                key={t.key}
                onPress={() => setSelectedKey(t.key)}
                style={styles.chip(on)}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityHint={
                  takenBy.has(t.key) ? "Already planned" : undefined
                }
              >
                <Text type="subheadline" style={styles.chipText(on)}>
                  {t.name}
                </Text>
                {takenBy.has(t.key) && <View style={styles.takenDot(on)} />}
              </Pressable>
            );
          })}

          {isNaming ? (
            <View style={styles.newField}>
              <TextInput
                value={newName}
                onChangeText={setNewName}
                placeholder="e.g. Supper"
                placeholderTextColor={theme.colors.placeholderText}
                autoFocus
                maxLength={24}
                returnKeyType="done"
                onSubmitEditing={handleSaveNew}
                onBlur={() => !newName.trim() && setIsNaming(false)}
                style={styles.newInput}
                accessibilityLabel="New meal time name"
              />
              <Pressable
                onPress={handleSaveNew}
                disabled={addMealTime.isPending}
                style={styles.newSave}
                accessibilityRole="button"
              >
                <Text type="footnote" style={styles.newSaveText}>
                  Add
                </Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={() => setIsNaming(true)}
              style={styles.newChip}
              accessibilityRole="button"
              accessibilityLabel="New meal time"
            >
              <Ionicons name="add" size={16} style={styles.newIcon} />
              <Text type="subheadline" style={styles.newChipText}>
                New
              </Text>
            </Pressable>
          )}
        </View>

        <Text type="footnote" style={styles.hint}>
          {hint}
        </Text>
      </View>
    );

    return (
      <RecipeBrowserSheet
        ref={browserRef}
        title={target ? `Add to ${target.label}` : "Add a meal"}
        onSelectRecipe={handleSelectRecipe}
        topContent={topContent}
      />
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  top: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 8,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  label: {
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.bold,
  },
  link: {
    color: theme.colors.primary,
    fontFamily: theme.fonts.bold,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: (on: boolean) => ({
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: on ? theme.colors.primary : theme.colors.inputBackground,
  }),
  chipText: (on: boolean) => ({
    fontFamily: theme.fonts.bold,
    color: on ? theme.colors.buttonText : theme.colors.text,
  }),
  takenDot: (on: boolean) => ({
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: on ? theme.colors.buttonText : theme.colors.textSecondary,
  }),
  newChip: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
  },
  newIcon: {
    color: theme.colors.primary,
  },
  newChipText: {
    fontFamily: theme.fonts.bold,
    color: theme.colors.primary,
  },
  newField: {
    height: 36,
    paddingLeft: 14,
    paddingRight: 4,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  newInput: {
    minWidth: 90,
    fontSize: 15,
    fontFamily: theme.fonts.bold,
    color: theme.colors.text,
    paddingVertical: 0,
  },
  newSave: {
    height: 28,
    paddingHorizontal: 12,
    borderRadius: 14,
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
    backgroundImage: theme.colors.primaryGradient,
  },
  newSaveText: {
    color: theme.colors.buttonText,
    fontFamily: theme.fonts.bold,
  },
  hint: {
    color: theme.colors.textSecondary,
  },
}));
