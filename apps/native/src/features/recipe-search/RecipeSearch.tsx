import { useFocusEffect } from "@react-navigation/native";
import { MIN_RECIPE_SEARCH_LENGTH } from "@repo/shared";
import { LinearGradient } from "expo-linear-gradient";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import {
  BackHandler,
  Keyboard,
  Pressable,
  ScrollView,
  TextInput,
  View,
  type ScrollViewInstance,
  type TextInputInstance,
} from "react-native";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { scheduleOnRN } from "react-native-worklets";

import {
  RecipeFilterSheet,
  type RecipeFilterSheetRef,
} from "./RecipeFilterSheet";
import { RecipeSearchResults } from "./RecipeSearchResults";
import {
  DEFAULT_RECIPE_SEARCH_FILTERS,
  type RecipeSearchFilters,
} from "./recipeSearchFilters";
import {
  searchChips,
  searchTokens,
  withoutLastToken,
  type SearchTag,
} from "./searchTokens";

import { useUserRecipeTags } from "@/api/recipe";
import { Ionicons } from "@/components/Ionicons";
import { Text } from "@/components/Text";
import { GlassSurface } from "@/components/glass/Glass";
import { useDebounce } from "@/hooks/useDebounce";
import { addRecentRecipeSearch } from "@/lib/recentRecipeSearches";
import { TAB_BAR_HEIGHT } from "@/navigation/tabBar";

const FIELD = 50;
const GAP = 8;
const H_PAD = 16;
/** Space between the field and the top of the keyboard. */
const KEYBOARD_GAP = 14;
const CHIP = 36;
/** Room around the chips so their shadows aren't clipped. */
const CHIP_PAD = 10;
/** The field and the fade above it, from the bottom of the stack. */
export const SEARCH_FIELD_CLEARANCE = FIELD + 24 + 12;
const FADE_TIMING = { duration: 300 };
const NO_TAGS: SearchTag[] = [];

export interface RecipeSearchRef {
  /** Leaves search, clearing what was typed and any filters. */
  close: () => void;
}

interface RecipeSearchProps {
  onOpenChange?: (open: boolean) => void;
  ref?: Ref<RecipeSearchRef>;
}

/**
 * Library search. The glass field sits at the bottom of the Recipes tab, in
 * reach of a thumb, and rides up on the keyboard. Tags, time limits and
 * sources become tokens inside the field, with chips above it to add more.
 */
export const RecipeSearch = ({ onOpenChange, ref }: RecipeSearchProps) => {
  const { theme, rt } = useUnistyles();
  const inputRef = useRef<TextInputInstance>(null);
  const tokenScrollRef = useRef<ScrollViewInstance>(null);
  const filterSheetRef = useRef<RecipeFilterSheetRef>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 250);
  const [filters, setFilters] = useState<RecipeSearchFilters>(
    DEFAULT_RECIPE_SEARCH_FILTERS,
  );
  const { data: tags = NO_TAGS } = useUserRecipeTags();

  const progress = useSharedValue(0);
  const { height: keyboardHeight, progress: keyboardProgress } =
    useReanimatedKeyboardAnimation();

  // ─── Open / close ─────────────────────────────────────────────────────────
  // The fade starts on touch down rather than on focus, which only arrives
  // once the keyboard is on its way, and the results are always mounted so
  // there's no first render to wait for either.
  const openSearch = useCallback(() => {
    if (open) return;
    setOpen(true);
    progress.set(withTiming(1, FADE_TIMING));
  }, [open, progress]);

  // Cleared once the results have faded, so they don't flash back to
  // recent searches on the way out.
  const resetSearch = useCallback(() => {
    setQuery("");
    setFilters(DEFAULT_RECIPE_SEARCH_FILTERS);
  }, []);

  const close = useCallback(() => {
    Keyboard.dismiss();
    inputRef.current?.blur();
    setOpen(false);
    progress.set(
      withTiming(0, FADE_TIMING, (finished) => {
        if (finished) scheduleOnRN(resetSearch);
      }),
    );
  }, [progress, resetSearch]);

  useImperativeHandle(ref, () => ({ close }), [close]);

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  // Android's back button leaves search rather than the tab, but only while
  // the Recipes tab is on screen and search is open.
  useFocusEffect(
    useCallback(() => {
      if (!open) return undefined;
      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          close();
          return true;
        },
      );
      return () => subscription.remove();
    }, [open, close]),
  );

  // ─── Tokens and chips ─────────────────────────────────────────────────────
  const tokens = useMemo(() => searchTokens(filters, tags), [filters, tags]);
  const chips = useMemo(() => searchChips(filters, tags), [filters, tags]);

  const updateFilters = useCallback(
    (update: (current: RecipeSearchFilters) => RecipeSearchFilters) =>
      setFilters(update),
    [],
  );

  // Keep the newest token and the caret in view.
  useEffect(() => {
    tokenScrollRef.current?.scrollToEnd({ animated: true });
  }, [tokens.length]);

  const handleKeyPress = useCallback(
    (key: string) => {
      if (key === "Backspace" && query === "" && tokens.length > 0) {
        setFilters((current) => withoutLastToken(current, tags));
      }
    },
    [query, tokens.length, tags],
  );

  const handleSubmit = useCallback(() => {
    const text = query.trim();
    if (text.length >= MIN_RECIPE_SEARCH_LENGTH) {
      addRecentRecipeSearch({ type: "query", text });
    }
  }, [query]);

  // ─── Layout ───────────────────────────────────────────────────────────────
  const bottomSystemInset =
    process.env.EXPO_OS === "android" ? rt.insets.bottom : 0;
  const restingGap = TAB_BAR_HEIGHT + bottomSystemInset + 20;

  // The stack sits above the tab bar, then rides the keyboard when it's up.
  const stackPadding = useAnimatedStyle(() => ({
    paddingBottom: interpolate(
      keyboardProgress.get(),
      [0, 1],
      [restingGap, KEYBOARD_GAP],
    ),
  }));
  const stackLift = useAnimatedStyle(() => ({
    transform: [{ translateY: keyboardHeight.get() }],
  }));

  const resultsStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
  }));
  const libraryFadeStyle = useAnimatedStyle(() => ({
    opacity: 1 - progress.get(),
  }));
  const closeSlotStyle = useAnimatedStyle(() => ({
    width: progress.get() * (FIELD + GAP),
  }));

  const stackHeight = SEARCH_FIELD_CLEARANCE + CHIP + CHIP_PAD + 4;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View
        style={[styles.results, resultsStyle]}
        // Hidden but mounted while closed, so opening has nothing to render.
        pointerEvents={open ? "auto" : "none"}
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? "auto" : "no-hide-descendants"}
      >
        <RecipeSearchResults
          query={query}
          debouncedQuery={debouncedQuery}
          filters={filters}
          onFiltersChange={updateFilters}
          onQueryChange={setQuery}
          tags={tags}
          stackHeight={stackHeight}
          restingGap={restingGap}
          keyboardGap={KEYBOARD_GAP}
        />
      </Animated.View>

      <Animated.View style={[styles.stack, stackLift]} pointerEvents="box-none">
        <Animated.View style={stackPadding} pointerEvents="box-none">
          {open && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="always"
              contentContainerStyle={styles.chips}
              style={styles.chipScroll}
            >
              {chips.map((chip) => (
                <SearchChipButton
                  key={chip.key}
                  label={chip.label}
                  icon="add"
                  onPress={() => {
                    if (chip.tag) {
                      addRecentRecipeSearch({ type: "tag", ...chip.tag });
                    }
                    setFilters(chip.apply);
                  }}
                />
              ))}
              <SearchChipButton
                label="Filters"
                icon="options-outline"
                onPress={() => {
                  Keyboard.dismiss();
                  filterSheetRef.current?.present(filters);
                }}
              />
            </ScrollView>
          )}

          <View
            style={[
              styles.fade,
              {
                // Reaches under the tab bar so the fade has no hard edge.
                paddingBottom: restingGap,
                marginBottom: -restingGap,
              },
            ]}
            pointerEvents="box-none"
          >
            {/* Only over the library. In search the results have their own
                background, and a fade there would cut off the chips' shadows. */}
            <Animated.View
              style={[StyleSheet.absoluteFill, libraryFadeStyle]}
              pointerEvents="none"
            >
              <LinearGradient
                colors={[
                  `${theme.colors.background}00`,
                  theme.colors.background,
                  theme.colors.background,
                ]}
                locations={[0, 0.45, 1]}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
            <View style={styles.fieldRow}>
              <GlassSurface
                interactive
                style={styles.field}
                contentStyle={styles.fieldContent}
              >
                <Ionicons name="search" size={20} style={styles.muted} />
                <ScrollView
                  ref={tokenScrollRef}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="always"
                  style={styles.tokenScroll}
                  contentContainerStyle={styles.tokenRow}
                >
                  {tokens.map((token) => (
                    <Pressable
                      key={token.key}
                      onPress={() => setFilters(token.without)}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${token.label}`}
                      style={({ pressed }) => [
                        styles.token,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text type="subheadline" style={styles.tokenText}>
                        {token.label}
                      </Text>
                      <Ionicons
                        name="close"
                        size={13}
                        style={styles.tokenText}
                      />
                    </Pressable>
                  ))}
                  <TextInput
                    ref={inputRef}
                    value={query}
                    onChangeText={setQuery}
                    onPressIn={openSearch}
                    onFocus={openSearch}
                    onSubmitEditing={handleSubmit}
                    onKeyPress={(event) =>
                      handleKeyPress(event.nativeEvent.key)
                    }
                    placeholder={tokens.length > 0 ? "" : "Search your library"}
                    placeholderTextColor={theme.colors.placeholderText}
                    accessibilityLabel="Search your library"
                    returnKeyType="search"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="off"
                    textContentType="none"
                    style={styles.input}
                  />
                </ScrollView>
                {query.length > 0 && (
                  <Pressable
                    onPress={() => setQuery("")}
                    accessibilityRole="button"
                    accessibilityLabel="Clear search"
                    hitSlop={10}
                  >
                    <Ionicons
                      name="close-circle"
                      size={18}
                      style={styles.muted}
                    />
                  </Pressable>
                )}
              </GlassSurface>

              <Animated.View
                style={[styles.closeSlot, closeSlotStyle]}
                pointerEvents={open ? "auto" : "none"}
                accessibilityElementsHidden={!open}
                importantForAccessibility={
                  open ? "auto" : "no-hide-descendants"
                }
              >
                <GlassSurface
                  interactive
                  hidden={!open}
                  style={styles.close}
                  contentStyle={styles.center}
                >
                  <Pressable
                    onPress={close}
                    accessibilityRole="button"
                    accessibilityLabel="Close search"
                    hitSlop={6}
                    style={styles.center}
                  >
                    <Ionicons name="close" size={22} style={styles.icon} />
                  </Pressable>
                </GlassSurface>
              </Animated.View>
            </View>
          </View>
        </Animated.View>
      </Animated.View>

      <RecipeFilterSheet
        ref={filterSheetRef}
        query={debouncedQuery}
        hasQuery={debouncedQuery.trim().length >= MIN_RECIPE_SEARCH_LENGTH}
        onApply={setFilters}
      />
    </View>
  );
};

interface SearchChipButtonProps {
  label: string;
  icon: "add" | "options-outline";
  onPress: () => void;
}

/**
 * A floating pill above the field. Not real glass: Liquid Glass stops drawing
 * its contents once it scrolls inside a ScrollView, which left blank chips.
 */
const SearchChipButton = ({ label, icon, onPress }: SearchChipButtonProps) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={icon === "add" ? `Add ${label}` : label}
    style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
  >
    <Ionicons name={icon} size={15} style={styles.chipIcon} />
    <Text type="subheadline" style={styles.chipText}>
      {label}
    </Text>
  </Pressable>
);

const styles = StyleSheet.create((theme) => ({
  results: {
    ...StyleSheet.absoluteFill,
    backgroundColor: theme.colors.background,
  },
  stack: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  // Glass shadows spread well past the chips; don't clip them to the row.
  chipScroll: {
    flexGrow: 0,
    overflow: "visible",
  },
  chips: {
    gap: GAP,
    paddingHorizontal: H_PAD,
    paddingTop: CHIP_PAD,
    // Room for the shadow; the field's own top padding does the rest.
    paddingBottom: 4,
  },
  chip: {
    height: CHIP,
    borderRadius: CHIP / 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingLeft: 11,
    paddingRight: 14,
    backgroundColor: theme.colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    boxShadow: "0 3px 12px rgba(0, 0, 0, 0.08)",
  },
  chipIcon: {
    color: theme.colors.textSecondary,
  },
  chipText: {
    fontFamily: theme.fonts.semiBold,
    color: theme.colors.text,
  },
  fade: {
    paddingTop: 6,
    paddingHorizontal: H_PAD,
  },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  field: {
    flex: 1,
    height: FIELD,
    borderRadius: FIELD / 2,
  },
  fieldContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 16,
    paddingRight: 14,
    gap: 8,
  },
  tokenScroll: {
    flex: 1,
  },
  tokenRow: {
    flexGrow: 1,
    alignItems: "center",
    gap: 6,
  },
  token: {
    height: 30,
    paddingLeft: 10,
    paddingRight: 8,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: theme.colors.primarySoft,
  },
  tokenText: {
    fontFamily: theme.fonts.semiBold,
    color: theme.colors.onPrimarySoft,
  },
  input: {
    flexGrow: 1,
    minWidth: 80,
    height: FIELD,
    fontSize: 17,
    letterSpacing: -0.4,
    fontFamily: theme.fonts.regular,
    color: theme.colors.text,
    paddingVertical: 0,
  },
  closeSlot: {
    height: FIELD,
    alignItems: "flex-end",
    overflow: "visible",
  },
  close: {
    width: FIELD,
    height: FIELD,
    borderRadius: FIELD / 2,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  icon: {
    color: theme.colors.text,
  },
  muted: {
    color: theme.colors.textTertiary,
  },
  pressed: {
    opacity: 0.6,
  },
}));
