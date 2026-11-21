import { Fragment, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { useFollowing, useSearchUsers, useSuggestedUsers } from "@/api/follows";
import { FollowUserRow } from "@/components/FollowUserRow";
import { OptimizedImage } from "@/components/OptimizedImage";
import { SystemIcon } from "@/components/SystemIcon";
import { Text } from "@/components/Text";
import { useDebounce } from "@/hooks/useDebounce";
import { getImageUrl } from "@/utils/imageUrl";

/** How many cooks to suggest; the screen prefetches the same list. */
export const SUGGESTED_COOKS = 12;
const MIN_QUERY = 2;
const SEARCH_LIMIT = 20;

/**
 * Step 2: cooks to follow, each with a strip of what they've cooked lately
 * so you can tell who's worth following, and a search for finding friends.
 */
export const OnboardingStepFollowCooks = () => {
  const { theme } = useUnistyles();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query.trim(), 300);
  const isSearching = debouncedQuery.length >= MIN_QUERY;
  const search = useSearchUsers({
    query: debouncedQuery,
    limit: SEARCH_LIMIT,
  });
  const { data: following } = useFollowing();
  const followingIds = new Set(following?.map((f) => f.user.id) ?? []);
  const { data: suggested, isLoading: isLoadingSuggested } =
    useSuggestedUsers(SUGGESTED_COOKS);
  // Photos that didn't load are dropped rather than left as blank tiles
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  // Search results don't carry photos, so they show as plain rows
  const photosOf = (cook: object) =>
    ("recentImages" in cook && Array.isArray(cook.recentImages)
      ? (cook.recentImages as string[])
      : []
    )
      .filter((url) => !failed.has(url) && getImageUrl(url, "thumb_200"))
      .slice(0, 3);

  // Cooks with something to show come first. The order is then fixed:
  // following someone refetches the list (sorted by followers), and rows
  // shouldn't jump while you work down it.
  const order = useRef<string[] | null>(null);
  const cooks = useMemo(() => {
    const list = suggested ?? [];
    if (!order.current && list.length) {
      order.current = [...list]
        .sort(
          (a, b) =>
            Number(b.recentImages.length > 0) -
            Number(a.recentImages.length > 0),
        )
        .map((cook) => cook.id);
    }
    const rank = new Map((order.current ?? []).map((id, i) => [id, i]));
    return [...list].sort(
      (a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity),
    );
  }, [suggested]);

  const shown = isSearching ? (search.data ?? []) : cooks;
  const isLoading = isSearching
    ? search.isPending || (search.isFetching && !shown.length)
    : isLoadingSuggested;

  return (
    <View>
      <Text style={styles.title} accessibilityRole="header">
        Follow cooks
      </Text>
      <Text style={styles.subtitle}>
        Follow your friends to see what they save and review in your feed.
      </Text>

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
          placeholder="Search by name or username"
          placeholderTextColor={theme.colors.textSecondary}
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="never"
          accessibilityLabel="Search cooks"
        />
        {query ? (
          <Pressable
            onPress={() => setQuery("")}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <SystemIcon
              sf="xmark.circle.fill"
              android="close-circle"
              size={17}
              color={theme.colors.textSecondary}
            />
          </Pressable>
        ) : null}
      </View>

      {isLoading ? (
        <ActivityIndicator style={styles.loading} />
      ) : !shown.length ? (
        <Text style={styles.empty}>
          {isSearching
            ? `No cooks called “${debouncedQuery}”. Check the spelling, or try their username.`
            : "No suggestions yet. You can find cooks any time from Home."}
        </Text>
      ) : (
        <View style={styles.list}>
          {shown.map((cook, i) => (
            <Fragment key={cook.id}>
              {i > 0 ? <View style={styles.separator} /> : null}
              <View style={styles.cook}>
                <FollowUserRow
                  user={cook}
                  isFollowing={followingIds.has(cook.id)}
                />
                {/* No saved recipes (or none that load): just their row */}
                {photosOf(cook).length ? (
                  <View style={styles.strip} accessibilityElementsHidden>
                    {photosOf(cook).map((url) => (
                      <OptimizedImage
                        key={url}
                        image={url}
                        preset="thumb_200"
                        style={styles.dish}
                        onError={() =>
                          setFailed((current) => new Set(current).add(url))
                        }
                      />
                    ))}
                  </View>
                ) : null}
              </View>
            </Fragment>
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create((theme, rt) => ({
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontFamily: theme.fonts.black,
    letterSpacing: -0.8,
    color: theme.colors.text,
  },
  subtitle: {
    marginTop: 6,
    fontSize: 16,
    lineHeight: 21,
    color: theme.colors.textSecondary,
  },
  search: {
    marginTop: 18,
    height: 44,
    borderRadius: 22,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: theme.colors.inputBackground,
  },
  searchInput: {
    flex: 1,
    height: 44,
    color: theme.colors.text,
    fontSize: 16,
    fontFamily: theme.fonts.medium,
  },
  loading: {
    paddingVertical: 48,
  },
  empty: {
    paddingVertical: 32,
    fontSize: 16,
    lineHeight: 21,
    color: theme.colors.textSecondary,
  },
  list: {
    marginTop: 10,
  },
  cook: {
    paddingVertical: 6,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
  },
  strip: {
    flexDirection: "row",
    gap: 6,
    marginTop: 2,
    marginBottom: 10,
  },
  dish: {
    // A real width up front, so the image loads at the right size
    width: (rt.screen.width - 48 - 12) / 3,
    height: 76,
    borderRadius: 14,
  },
}));
