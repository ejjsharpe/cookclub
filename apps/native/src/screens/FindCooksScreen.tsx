import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";
import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import {
  useFollowing,
  useSearchUsers,
  useSuggestedUsers,
  type SearchUser,
} from "@/api/follows";
import { FollowUserRow } from "@/components/FollowUserRow";
import { Text } from "@/components/Text";
import { SignatureIcon } from "@/components/icons/SignatureIcon";
import { useDebounce } from "@/hooks/useDebounce";

const MIN_QUERY_LENGTH = 2;
const RESULT_LIMIT = 20;
const ROW_INSET = 20;

/**
 * The search bar is declared in the route's options so it exists from the
 * first frame. Adding it later (from an effect) makes iOS inset the list for a
 * header without it, leaving a gap under the bar on every visit.
 */
export const FIND_COOKS_SEARCH_BAR = {
  placeholder: "Name or @username",
  autoCapitalize: "none",
  autoFocus: true,
  hideWhenScrolling: false,
  obscureBackground: false,
  // iOS 26: a Liquid Glass field in the bottom toolbar, as in Apple's own
  // apps. It rises with the keyboard instead of animating out of the nav bar.
  // Earlier iOS versions fall back to a field in the nav bar.
  placement: "integrated",
  allowToolbarIntegration: true,
} as const satisfies NativeStackNavigationOptions["headerSearchBarOptions"];

type CookRow = SearchUser & { recipeCount?: number; followerCount?: number };

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** "@sam · 12 recipes" for suggestions, which come with counts. */
function cookSubtitle(cook: CookRow): string | undefined {
  const parts = [
    cook.username ? `@${cook.username}` : null,
    cook.recipeCount ? plural(cook.recipeCount, "recipe") : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

/**
 * Find cooks: a native large-title screen with the system search bar.
 * Shows suggestions until you type, then live results.
 */
export const FindCooksScreen = () => {
  const navigation = useNavigation();
  const { theme } = useUnistyles();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query.trim(), 300);
  const isSearching = debouncedQuery.length >= MIN_QUERY_LENGTH;

  const search = useSearchUsers({ query: debouncedQuery, limit: RESULT_LIMIT });
  const suggested = useSuggestedUsers(RESULT_LIMIT);
  const { data: following } = useFollowing();
  const followingIds = useMemo(
    () => new Set(following?.map((f) => f.user.id) ?? []),
    [following],
  );

  const active = isSearching ? search : suggested;
  const cooks: CookRow[] = (isSearching ? search.data : suggested.data) ?? [];
  const isLoading = active.isPending || (active.isFetching && !cooks.length);

  useLayoutEffect(() => {
    const options: NativeStackNavigationOptions = {
      headerSearchBarOptions: {
        ...FIND_COOKS_SEARCH_BAR,
        tintColor: theme.colors.primary,
        onChangeText: (event) => setQuery(event.nativeEvent.text),
        onCancelButtonPress: () => setQuery(""),
      },
    };
    navigation.setOptions(options);
  }, [navigation, theme.colors.primary]);

  const handleUserPress = useCallback(
    (userId: string) => navigation.navigate("UserProfile", { userId }),
    [navigation],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<CookRow>) => (
      <FollowUserRow
        user={item}
        isFollowing={followingIds.has(item.id)}
        onUserPress={() => handleUserPress(item.id)}
        subtitle={cookSubtitle(item)}
        style={styles.row}
      />
    ),
    [followingIds, handleUserPress],
  );

  const header = isSearching ? undefined : (
    <Text type="headline" style={styles.sectionTitle}>
      Suggested for you
    </Text>
  );

  const empty = isLoading ? (
    <View style={styles.state}>
      <ActivityIndicator color={theme.colors.textSecondary} />
    </View>
  ) : (
    <View style={styles.state}>
      <SignatureIcon
        name="search"
        size={32}
        color={theme.colors.textSecondary}
      />
      <Text type="headline" style={styles.stateTitle}>
        {isSearching ? "No cooks found" : "No suggestions yet"}
      </Text>
      <Text type="subheadline" style={styles.stateBody}>
        {isSearching
          ? `Nobody matches “${debouncedQuery}”. Try a name or @username.`
          : "Search for friends by name or @username."}
      </Text>
    </View>
  );

  return (
    <FlatList
      data={cooks}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      style={styles.list}
      contentContainerStyle={styles.content}
    />
  );
};

const styles = StyleSheet.create((theme, rt) => ({
  list: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    paddingBottom: rt.insets.bottom + 24,
  },
  sectionTitle: {
    paddingHorizontal: ROW_INSET,
    paddingTop: 12,
    paddingBottom: 4,
  },
  row: {
    paddingHorizontal: ROW_INSET,
  },
  state: {
    alignItems: "center",
    paddingHorizontal: 40,
    paddingTop: 80,
    gap: 8,
  },
  stateTitle: {
    marginTop: 4,
  },
  stateBody: {
    color: theme.colors.textSecondary,
    textAlign: "center",
  },
}));
