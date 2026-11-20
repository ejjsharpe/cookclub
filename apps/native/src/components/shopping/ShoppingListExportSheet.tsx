import type { TrueSheet } from "@lodev09/react-native-true-sheet";
import { LinearGradient } from "expo-linear-gradient";
import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Pressable, Share, Switch, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { AppSheet } from "@/components/AppSheet";
import { Ionicons } from "@/components/Ionicons";
import { Text } from "@/components/Text";
import { ScalePressable } from "@/components/buttons/ScalePressable";
import {
  countShareableItems,
  groupShoppingList,
  sectionLines,
  shoppingListText,
  type ShoppingListItem,
  type ShoppingListRecipe,
  type ShoppingListView,
} from "@/lib/shoppingListGroups";

export interface ShoppingListExportSheetRef {
  present: () => void;
  dismiss: () => void;
}

interface ShoppingListExportSheetProps {
  listName: string;
  items: ShoppingListItem[];
  recipes: ShoppingListRecipe[];
  /** The list's current grouping, used until the person picks another. */
  view: ShoppingListView;
}

const PREVIEW_HEIGHT = 240;

/** Shares the list as plain text, e.g. into Notes or Messages. */
export const ShoppingListExportSheet = forwardRef<
  ShoppingListExportSheetRef,
  ShoppingListExportSheetProps
>(({ listName, items, recipes, view }, ref) => {
  const { theme } = useUnistyles();
  const sheetRef = useRef<TrueSheet>(null);
  const [showOptions, setShowOptions] = useState(false);
  const [groupBy, setGroupBy] = useState<ShoppingListView>(view);
  const [includeTicked, setIncludeTicked] = useState(false);
  const [showRecipe, setShowRecipe] = useState(false);

  useImperativeHandle(ref, () => ({
    present: () => {
      setGroupBy(view);
      setShowOptions(false);
      sheetRef.current?.present();
    },
    dismiss: () => sheetRef.current?.dismiss(),
  }));

  const sections = useMemo(
    () => groupShoppingList(items, recipes, groupBy),
    [items, recipes, groupBy],
  );
  const text = useMemo(
    () => shoppingListText(listName, sections, { includeTicked, showRecipe }),
    [listName, sections, includeTicked, showRecipe],
  );
  const count = countShareableItems(sections, includeTicked);

  const summary = [
    `${count} item${count === 1 ? "" : "s"} by ${groupBy}`,
    includeTicked ? "ticked items marked ✓" : "ticked items left out",
  ].join(" · ");

  const handleShare = async () => {
    try {
      await Share.share({ message: text, title: listName });
    } catch {
      // The person closed the share sheet
    }
  };

  return (
    <AppSheet
      ref={sheetRef}
      title="Share list"
      detents={["auto"]}
      backgroundColor={theme.colors.background}
    >
      <View style={styles.body}>
        <View style={styles.preview}>
          <Text type="headline" style={styles.previewTitle}>
            {listName}
          </Text>
          {sections.map((section) => {
            const lines = sectionLines(section, { includeTicked, showRecipe });
            if (!lines.length) return null;
            return (
              <View key={section.key} style={styles.previewSection}>
                <Text type="subheadline" style={styles.previewHeading}>
                  {section.title}
                </Text>
                <Text type="subheadline" style={styles.previewLines}>
                  {lines.join("\n")}
                </Text>
              </View>
            );
          })}
          <LinearGradient
            colors={[`${theme.colors.background}00`, theme.colors.background]}
            style={styles.previewFade}
            pointerEvents="none"
          />
        </View>

        <Pressable
          style={styles.optionsToggle}
          onPress={() => setShowOptions((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: showOptions }}
        >
          <Text type="subheadline" style={styles.optionsLabel}>
            Options
          </Text>
          <Ionicons
            name={showOptions ? "chevron-up" : "chevron-down"}
            size={16}
            style={styles.optionsChevron}
          />
        </Pressable>

        {showOptions && (
          <View style={styles.options}>
            <View style={styles.optionRow}>
              <Text type="body" style={styles.optionText}>
                Group by
              </Text>
              <View style={styles.segment} accessibilityRole="tablist">
                {(["aisle", "recipe"] as const).map((option) => (
                  <Pressable
                    key={option}
                    onPress={() => setGroupBy(option)}
                    style={styles.segmentItem(groupBy === option)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: groupBy === option }}
                  >
                    <Text
                      type="footnote"
                      style={styles.segmentText(groupBy === option)}
                    >
                      {option === "aisle" ? "Aisle" : "Recipe"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <View style={styles.optionDivider} />
            <View style={styles.optionRow}>
              <Text type="body" style={styles.optionText}>
                Include ticked items
              </Text>
              <Switch
                value={includeTicked}
                onValueChange={setIncludeTicked}
                trackColor={{ true: theme.colors.primary }}
              />
            </View>
            {groupBy === "aisle" && (
              <>
                <View style={styles.optionDivider} />
                <View style={styles.optionRow}>
                  <Text type="body" style={styles.optionText}>
                    Show which recipe
                  </Text>
                  <Switch
                    value={showRecipe}
                    onValueChange={setShowRecipe}
                    trackColor={{ true: theme.colors.primary }}
                  />
                </View>
              </>
            )}
          </View>
        )}

        <ScalePressable
          onPress={handleShare}
          disabled={count === 0}
          style={styles.shareButton(count === 0)}
          accessibilityRole="button"
          accessibilityLabel="Share list"
        >
          <Ionicons name="share-outline" size={20} color="#fff" />
          <Text type="headline" style={styles.shareText}>
            Share…
          </Text>
        </ScalePressable>
        <Text type="caption" style={styles.summary}>
          {count === 0 ? "Nothing left to share" : summary}
        </Text>
      </View>
    </AppSheet>
  );
});

const styles = StyleSheet.create((theme) => ({
  body: {
    paddingHorizontal: 20,
    paddingBottom: 8,
    gap: 12,
  },
  preview: {
    maxHeight: PREVIEW_HEIGHT,
    overflow: "hidden",
  },
  previewTitle: {
    fontFamily: theme.fonts.black,
    fontSize: 18,
  },
  previewSection: {
    marginTop: 10,
  },
  previewHeading: {
    fontFamily: theme.fonts.bold,
  },
  previewLines: {
    color: theme.colors.textSecondary,
  },
  previewFade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 64,
  },
  optionsToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingVertical: 4,
  },
  optionsLabel: {
    color: theme.colors.primary,
    fontFamily: theme.fonts.bold,
  },
  optionsChevron: {
    color: theme.colors.primary,
  },
  options: {
    borderRadius: 18,
    backgroundColor: theme.colors.inputBackground,
  },
  optionRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    gap: 12,
  },
  optionText: {
    flex: 1,
  },
  optionDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
    marginLeft: 14,
  },
  segment: {
    flexDirection: "row",
    borderRadius: 16,
    padding: 2,
    backgroundColor: theme.colors.textTertiary,
  },
  segmentItem: (on: boolean) => ({
    height: 28,
    paddingHorizontal: 12,
    borderRadius: 14,
    justifyContent: "center",
    backgroundColor: on ? theme.colors.background : "transparent",
  }),
  segmentText: (on: boolean) => ({
    fontFamily: theme.fonts.bold,
    color: on ? theme.colors.text : theme.colors.textSecondary,
  }),
  shareButton: (disabled: boolean) => ({
    height: 54,
    borderRadius: 27,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 4,
    backgroundColor: theme.colors.primary,
    opacity: disabled ? 0.4 : 1,
    shadowColor: theme.colors.primary,
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  }),
  shareText: {
    color: "#fff",
    fontFamily: theme.fonts.bold,
  },
  summary: {
    textAlign: "center",
    color: theme.colors.textSecondary,
  },
}));
