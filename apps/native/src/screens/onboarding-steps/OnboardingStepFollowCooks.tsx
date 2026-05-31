import { useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { useSearchUsers, useSuggestedUsers, useFollowing } from "@/api/follows";
import { FollowUserRow } from "@/components/FollowUserRow";
import { Input } from "@/components/Input";
import { VSpace } from "@/components/Space";
import { Text } from "@/components/Text";
import { useDebounce } from "@/hooks/useDebounce";

export const OnboardingStepFollowCooks = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedQuery = useDebounce(searchQuery, 300);

  const { data: following } = useFollowing();
  const followingIds = new Set(following?.map((f) => f.user.id) ?? []);

  const { data: suggestedUsers, isLoading: isSuggestedLoading } =
    useSuggestedUsers(20);
  const { data: searchResults, isLoading: isSearchLoading } = useSearchUsers({
    query: debouncedQuery,
    limit: 20,
  });

  const isSearching = debouncedQuery.length >= 2;
  const users = isSearching ? searchResults : suggestedUsers;
  const isLoading = isSearching ? isSearchLoading : isSuggestedLoading;

  return (
    <View style={styles.container}>
      <Text type="title2" style={styles.title}>
        Follow some cooks
      </Text>
      <VSpace size={6} />
      <Text type="bodyFaded" style={styles.subtitle}>
        See what they're cooking in your feed
      </Text>
      <VSpace size={24} />

      <Input
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder="Search for cooks..."
        autoCapitalize="none"
        autoCorrect={false}
      />

      <VSpace size={16} />

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" />
        </View>
      ) : users && users.length > 0 ? (
        <View style={styles.usersList}>
          {users.map((u) => (
            <FollowUserRow
              key={u.id}
              user={u}
              isFollowing={followingIds.has(u.id)}
            />
          ))}
        </View>
      ) : (
        <View style={styles.emptyContainer}>
          <Text type="bodyFaded" style={styles.emptyText}>
            {isSearching ? "No cooks found" : "No suggestions available"}
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
  },
  title: {
    textAlign: "left",
    letterSpacing: -1,
    paddingHorizontal: 2,
  },
  subtitle: {
    paddingHorizontal: 2,
  },
  usersList: {
    gap: 6,
  },
  loadingContainer: {
    paddingVertical: 40,
    alignItems: "center",
  },
  emptyContainer: {
    paddingVertical: 40,
    alignItems: "center",
  },
  emptyText: {
    textAlign: "center",
  },
}));
