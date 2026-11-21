import type { TrueSheet } from "@lodev09/react-native-true-sheet";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  TextInput,
  View,
  type TextInputInstance,
} from "react-native";
import Animated, {
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { AppSheet } from "@/components/AppSheet";
import { Avatar } from "@/components/Avatar";
import { SystemIcon } from "@/components/SystemIcon";
import { Text } from "@/components/Text";
import { PrimaryButton } from "@/components/buttons/PrimaryButton";

export interface StartSharingFriend {
  id: string;
  name: string;
  image?: string | null;
}

export interface StartSharingSheetRef {
  present: () => void;
  dismiss: () => void;
}

interface StartSharingSheetProps {
  /** "Plan together" */
  title: string;
  /** One line under the name: what the new one is, and that yours stays yours. */
  note: string;
  defaultName: string;
  /** "plan" or "list", for the button when nobody is picked */
  resourceLabel: string;
  friends?: StartSharingFriend[];
  isLoadingFriends: boolean;
  /** Creates the shared plan or list and invites everyone picked. */
  onCreate: (name: string, userIds: string[]) => Promise<void>;
}

const OPEN_MS = 220;
const CHIP_HEIGHT = 34;
const CHIPS_GAP = 18;
const CHIPS_ROW_HEIGHT = CHIP_HEIGHT + CHIPS_GAP;
// A chip springs gently in once its row has room, and fades when removed
const CHIP_IN = () => {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.9 }] },
    animations: {
      opacity: withDelay(80, withTiming(1, { duration: 160 })),
      // Damped so it settles with the faintest overshoot, not a bounce
      transform: [
        {
          scale: withDelay(
            80,
            withSpring(1, { damping: 20, stiffness: 300, mass: 0.8 }),
          ),
        },
      ],
    },
  };
};
const CHIP_OUT = FadeOut.duration(120);
const CHIP_MOVE = LinearTransition.duration(200);

/**
 * Starts a shared plan or list from a personal one, which can't be shared.
 * The name is the heading, edited in place. Whoever you've picked sits at
 * the top as chips, above a search field and a plain list of friends.
 */
export const StartSharingSheet = forwardRef<
  StartSharingSheetRef,
  StartSharingSheetProps
>(
  (
    {
      title,
      note,
      defaultName,
      resourceLabel,
      friends,
      isLoadingFriends,
      onCreate,
    },
    ref,
  ) => {
    const { theme, rt } = useUnistyles();
    const sheetRef = useRef<TrueSheet>(null);
    const nameRef = useRef<TextInputInstance>(null);
    const [name, setName] = useState(defaultName);
    const [query, setQuery] = useState("");
    const [picked, setPicked] = useState<string[]>([]);
    const [isCreating, setIsCreating] = useState(false);

    useImperativeHandle(ref, () => ({
      present: () => sheetRef.current?.present(),
      dismiss: () => sheetRef.current?.dismiss(),
    }));

    const reset = useCallback(() => {
      setName(defaultName);
      setQuery("");
      setPicked([]);
      setIsCreating(false);
    }, [defaultName]);

    const toggle = (id: string) =>
      setPicked((current) =>
        current.includes(id)
          ? current.filter((x) => x !== id)
          : [...current, id],
      );

    const pickedFriends = useMemo(
      () =>
        picked
          .map((id) => friends?.find((f) => f.id === id))
          .filter((f): f is StartSharingFriend => Boolean(f)),
      [picked, friends],
    );
    const shownFriends = useMemo(() => {
      const q = query.trim().toLowerCase();
      return q
        ? (friends ?? []).filter((f) => f.name.toLowerCase().includes(q))
        : (friends ?? []);
    }, [friends, query]);

    // The chips row grows open for the first pick and closes after the last
    const hasPicks = useSharedValue(0);
    useEffect(() => {
      hasPicks.set(withTiming(picked.length ? 1 : 0, { duration: OPEN_MS }));
    }, [picked.length, hasPicks]);
    const chipsRowStyle = useAnimatedStyle(() => ({
      height: hasPicks.get() * CHIPS_ROW_HEIGHT,
      opacity: hasPicks.get(),
    }));

    const trimmed = name.trim();
    const handleCreate = async () => {
      if (!trimmed || isCreating) return;
      setIsCreating(true);
      try {
        await onCreate(trimmed, picked);
        sheetRef.current?.dismiss();
      } catch {
        // The mutation hooks explain what went wrong
        setIsCreating(false);
      }
    };

    const buttonLabel = isCreating
      ? "Creating…"
      : picked.length
        ? `Create and invite ${picked.length}`
        : `Create ${resourceLabel}`;

    const footer = (
      <View style={[styles.footer, { paddingBottom: rt.insets.bottom + 8 }]}>
        <PrimaryButton onPress={handleCreate} disabled={!trimmed || isCreating}>
          {buttonLabel}
        </PrimaryButton>
      </View>
    );

    return (
      <AppSheet
        ref={sheetRef}
        title={title}
        detents={[1]}
        scrollable
        footer={footer}
        onDidDismiss={reset}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable
            style={styles.nameRow}
            onPress={() => nameRef.current?.focus()}
            accessible={false}
          >
            <TextInput
              ref={nameRef}
              value={name}
              onChangeText={setName}
              placeholder={defaultName}
              placeholderTextColor={theme.colors.placeholderText}
              style={styles.name}
              returnKeyType="done"
              maxLength={60}
              accessibilityLabel="Name"
            />
            <SystemIcon
              sf="pencil"
              android="pencil"
              size={16}
              color={theme.colors.textSecondary}
            />
          </Pressable>
          <Text type="body" style={styles.note}>
            {note}
          </Text>

          {/* Opens to fit the chips, pushing the search and list down */}
          <Animated.View style={[styles.chipsRow, chipsRowStyle]}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipsScroller}
              contentContainerStyle={styles.chips}
              keyboardShouldPersistTaps="handled"
            >
              {pickedFriends.map((friend) => (
                <Animated.View
                  key={friend.id}
                  entering={CHIP_IN}
                  exiting={CHIP_OUT}
                  layout={CHIP_MOVE}
                >
                  <Pressable
                    onPress={() => toggle(friend.id)}
                    style={({ pressed }) => [
                      styles.chip,
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${friend.name}`}
                  >
                    <Avatar
                      imageUrl={friend.image}
                      name={friend.name}
                      size={28}
                    />
                    <Text type="subheadline" style={styles.chipName}>
                      {friend.name.split(" ")[0]}
                    </Text>
                    <SystemIcon
                      sf="xmark"
                      android="close"
                      size={11}
                      color={theme.colors.textSecondary}
                    />
                  </Pressable>
                </Animated.View>
              ))}
            </ScrollView>
          </Animated.View>

          <View style={styles.search}>
            <SystemIcon
              sf="magnifyingglass"
              android="search"
              size={16}
              color={theme.colors.textSecondary}
            />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search friends"
              placeholderTextColor={theme.colors.textSecondary}
              style={styles.searchInput}
              autoCorrect={false}
              returnKeyType="search"
              accessibilityLabel="Search friends"
            />
          </View>

          {isLoadingFriends ? (
            <ActivityIndicator style={styles.loading} />
          ) : !friends?.length ? (
            <Text type="bodyFaded" style={styles.empty}>
              People you follow, or who follow you, show up here.
            </Text>
          ) : !shownFriends.length ? (
            <Text type="bodyFaded" style={styles.empty}>
              No friends called “{query.trim()}”
            </Text>
          ) : (
            shownFriends.map((friend) => {
              const isPicked = picked.includes(friend.id);
              return (
                <Pressable
                  key={friend.id}
                  onPress={() => toggle(friend.id)}
                  style={({ pressed }) => [
                    styles.friend,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isPicked }}
                  accessibilityLabel={friend.name}
                >
                  <Avatar
                    imageUrl={friend.image}
                    name={friend.name}
                    size={40}
                  />
                  <Text type="body" numberOfLines={1} style={styles.friendName}>
                    {friend.name}
                  </Text>
                  {isPicked ? (
                    <SystemIcon
                      sf="checkmark"
                      android="checkmark"
                      size={18}
                      color={theme.colors.primary}
                    />
                  ) : null}
                </Pressable>
              );
            })
          )}
        </ScrollView>
      </AppSheet>
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  content: {
    paddingHorizontal: 20,
    paddingTop: 8,
    // Room to scroll the last friend above the button
    paddingBottom: 120,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  name: {
    flexShrink: 1,
    paddingVertical: 4,
    color: theme.colors.text,
    fontSize: 28,
    fontFamily: theme.fonts.black,
    letterSpacing: -0.6,
  },
  note: {
    marginTop: 2,
    color: theme.colors.textSecondary,
  },
  chipsRow: {
    overflow: "hidden",
    marginHorizontal: -20,
    justifyContent: "flex-end",
  },
  chipsScroller: {
    flexGrow: 0,
    height: CHIP_HEIGHT,
  },
  chips: {
    paddingHorizontal: 20,
    gap: 8,
  },
  chip: {
    height: CHIP_HEIGHT,
    paddingLeft: 3,
    paddingRight: 11,
    borderRadius: 17,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: theme.colors.inputBackground,
  },
  chipName: {
    fontFamily: theme.fonts.bold,
  },
  search: {
    marginTop: 14,
    marginBottom: 6,
    height: 40,
    borderRadius: 20,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: theme.colors.inputBackground,
  },
  searchInput: {
    flex: 1,
    height: 40,
    color: theme.colors.text,
    fontSize: 16,
    fontFamily: theme.fonts.medium,
  },
  loading: {
    paddingVertical: 32,
  },
  empty: {
    paddingVertical: 20,
  },
  friend: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
  },
  pressed: {
    opacity: 0.6,
  },
  friendName: {
    flex: 1,
    fontFamily: theme.fonts.semiBold,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    backgroundColor: theme.colors.background,
  },
}));
