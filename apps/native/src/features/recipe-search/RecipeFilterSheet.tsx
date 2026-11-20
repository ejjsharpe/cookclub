import { TrueSheet } from "@lodev09/react-native-true-sheet";
import {
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";

import { FilterChip } from "./FilterChip";
import {
  DEFAULT_RECIPE_SEARCH_FILTERS,
  SOURCE_OPTIONS,
  TIME_OPTIONS,
  activeFilterCount,
  sortOptions,
  type RecipeSearchFilters,
} from "./recipeSearchFilters";

import { useGetUserRecipes, useUserRecipeTags } from "@/api/recipe";
import { Ionicons } from "@/components/Ionicons";
import { Text } from "@/components/Text";

/** How many recipes the "Show N recipes" preview counts before saying N+. */
const PREVIEW_LIMIT = 50;

export interface RecipeFilterSheetRef {
  present: (current: RecipeSearchFilters) => void;
}

interface RecipeFilterSheetProps {
  /** The query typed in the search field, so the preview count matches. */
  query: string;
  /** Whether that query is long enough to search, which makes the default sort "Best match". */
  hasQuery: boolean;
  onApply: (filters: RecipeSearchFilters) => void;
  ref?: Ref<RecipeFilterSheetRef>;
}

/**
 * Sort and filters for library search. A plain TrueSheet rather than AppSheet:
 * AppSheet always sets a background colour, which turns off Liquid Glass.
 */
export const RecipeFilterSheet = ({
  query,
  hasQuery,
  onApply,
  ref,
}: RecipeFilterSheetProps) => {
  const sheetRef = useRef<TrueSheet>(null);
  const [draft, setDraft] = useState(DEFAULT_RECIPE_SEARCH_FILTERS);
  const [isOpen, setIsOpen] = useState(false);
  const [tagQuery, setTagQuery] = useState("");
  const { data: tags = [] } = useUserRecipeTags();
  const theme = UnistylesRuntime.getTheme();

  useImperativeHandle(ref, () => ({
    present: (current) => {
      setDraft(current);
      setTagQuery("");
      setIsOpen(true);
      sheetRef.current?.present();
    },
  }));

  const hasChanges = draft.sort !== "default" || activeFilterCount(draft) > 0;
  // With no query and nothing chosen, applying just returns to recent
  // searches, so there's no result count to promise.
  const showsResults = hasQuery || hasChanges;

  const { data: preview } = useGetUserRecipes({
    search: query,
    limit: PREVIEW_LIMIT,
    tagIds: draft.tagIds,
    ...(draft.maxTotalTime == null ? {} : { maxTotalTime: draft.maxTotalTime }),
    ...(draft.source ? { source: draft.source } : {}),
    enabled: isOpen && showsResults,
    keepPreviousData: true,
  });
  const firstPage = preview?.pages[0];
  const previewCount = firstPage?.items.length;
  const showLabel = !showsResults
    ? "Done"
    : previewCount === undefined
      ? "Show recipes"
      : previewCount === 0
        ? "No recipes match"
        : firstPage?.nextCursor
          ? `Show ${PREVIEW_LIMIT}+ recipes`
          : `Show ${previewCount} ${previewCount === 1 ? "recipe" : "recipes"}`;

  const update = useCallback(
    (patch: Partial<RecipeSearchFilters>) =>
      setDraft((current) => ({ ...current, ...patch })),
    [],
  );

  const toggleTag = useCallback((tagId: number) => {
    setDraft((current) => ({
      ...current,
      tagIds: current.tagIds.includes(tagId)
        ? current.tagIds.filter((id) => id !== tagId)
        : [...current.tagIds, tagId],
    }));
  }, []);

  // Picked tags first, then the most used.
  const visibleTags = useMemo(() => {
    const needle = tagQuery.trim().toLowerCase();
    return tags
      .filter((tag) => !needle || tag.name.toLowerCase().includes(needle))
      .sort((a, b) => {
        const pickedA = draft.tagIds.includes(a.id) ? 1 : 0;
        const pickedB = draft.tagIds.includes(b.id) ? 1 : 0;
        return (
          pickedB - pickedA ||
          b.recipeCount - a.recipeCount ||
          a.name.localeCompare(b.name)
        );
      });
  }, [tags, tagQuery, draft.tagIds]);

  const close = () => {
    sheetRef.current?.dismiss();
  };
  const apply = () => {
    onApply(draft);
    close();
  };

  const header = (
    <View style={styles.header}>
      <Pressable
        onPress={close}
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={styles.closeButton}
      >
        <Ionicons name="close" size={18} style={styles.closeIcon} />
      </Pressable>
      <Text type="headline" style={styles.title}>
        Filter & sort
      </Text>
      <Pressable
        onPress={() => setDraft(DEFAULT_RECIPE_SEARCH_FILTERS)}
        disabled={!hasChanges}
        accessibilityRole="button"
        style={styles.clearButton}
      >
        <Text
          type="subheadline"
          style={[styles.clearText, !hasChanges && styles.clearDisabled]}
        >
          Clear all
        </Text>
      </Pressable>
    </View>
  );

  const footer = (
    <View style={styles.footer}>
      <Pressable
        onPress={apply}
        accessibilityRole="button"
        style={({ pressed }) => [styles.showButton, pressed && styles.pressed]}
      >
        <Text type="headline" style={styles.showText}>
          {showLabel}
        </Text>
      </Pressable>
    </View>
  );

  return (
    <TrueSheet
      ref={sheetRef}
      detents={[0.75, 1]}
      scrollable
      grabber
      header={header}
      footer={footer}
      onDidDismiss={() => setIsOpen(false)}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Section title="Sort by">
          {sortOptions(hasQuery).map((option) => (
            <FilterChip
              key={option.value}
              label={option.label}
              selected={draft.sort === option.value}
              onPress={() => update({ sort: option.value })}
            />
          ))}
        </Section>

        <Section title="Max cooking time">
          {TIME_OPTIONS.map((option) => (
            <FilterChip
              key={option.minutes}
              label={option.label}
              selected={draft.maxTotalTime === option.minutes}
              onPress={() =>
                update({
                  maxTotalTime:
                    draft.maxTotalTime === option.minutes
                      ? null
                      : option.minutes,
                })
              }
            />
          ))}
        </Section>

        <Section title="Source">
          {SOURCE_OPTIONS.map((option) => (
            <FilterChip
              key={option.value}
              label={option.label}
              selected={draft.source === option.value}
              onPress={() =>
                update({
                  source: draft.source === option.value ? null : option.value,
                })
              }
            />
          ))}
        </Section>

        {tags.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text type="headline">Your tags</Text>
              <Text type="footnote" style={styles.secondary}>
                {tags.length} {tags.length === 1 ? "tag" : "tags"}
              </Text>
            </View>
            {tags.length > 8 && (
              <View style={styles.tagFinder}>
                <Ionicons name="search" size={16} style={styles.secondary} />
                <TextInput
                  value={tagQuery}
                  onChangeText={setTagQuery}
                  placeholder="Find a tag"
                  placeholderTextColor={theme.colors.placeholderText}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.tagFinderInput}
                />
              </View>
            )}
            <View style={styles.chips}>
              {visibleTags.map((tag) => (
                <FilterChip
                  key={tag.id}
                  label={tag.name}
                  count={tag.recipeCount}
                  selected={draft.tagIds.includes(tag.id)}
                  onPress={() => toggleTag(tag.id)}
                />
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </TrueSheet>
  );
};

const Section = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <View style={styles.section}>
    <Text type="headline">{title}</Text>
    <View style={styles.chips}>{children}</View>
  </View>
);

const styles = StyleSheet.create((theme) => ({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.pressHighlight,
  },
  closeIcon: {
    color: theme.colors.text,
  },
  title: {
    flex: 1,
    textAlign: "center",
  },
  clearButton: {
    minWidth: 64,
    height: 40,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  clearText: {
    fontFamily: theme.fonts.semiBold,
    color: theme.colors.primary,
  },
  clearDisabled: {
    color: theme.colors.textTertiary,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 24,
    gap: 24,
  },
  section: {
    gap: 12,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  secondary: {
    color: theme.colors.textSecondary,
  },
  tagFinder: {
    height: 38,
    borderRadius: 19,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: theme.colors.inputBackground,
  },
  tagFinderInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: theme.fonts.regular,
    color: theme.colors.text,
    paddingVertical: 0,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
  },
  showButton: {
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
    backgroundImage: theme.colors.primaryGradient,
  },
  showText: {
    color: theme.colors.buttonText,
  },
  pressed: {
    opacity: 0.85,
  },
}));
