import { RouteProp, useRoute, useNavigation } from "@react-navigation/native";
import { useState } from "react";
import { View, FlatList, ActivityIndicator } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import {
  useFollowing,
  useUserFollowers,
  useUserFollowing,
} from "@/api/follows";
import { FollowUserRow } from "@/components/FollowUserRow";
import { NavigationHeader } from "@/components/NavigationHeader";
import { SafeAreaView } from "@/components/SafeAreaView";
import { VSpace } from "@/components/Space";
import { Text } from "@/components/Text";
import { useSessionContext } from "@/lib/sessionContext";
import type { AppParamList } from "@/navigation/navigationRef";

type TabType = "following" | "followers";

interface FollowUser {
  followId: number;
  user: {
    id: string;
    name: string;
    username?: string | null;
    image?: string | null;
    subscriptionTier?: string | null;
  };
  followedAt: string;
}

type FollowsScreenRouteProp = RouteProp<AppParamList, "FollowsList">;
const UserSeparator = () => <VSpace size={6} />;

export const FollowsScreen = () => {
  const route = useRoute<FollowsScreenRouteProp>();
  const navigation = useNavigation();
  const { userId, activeTab: initialTab, userName } = route.params;
  const session = useSessionContext();
  const currentUserId = session?.user.id;

  const [activeTab, setActiveTab] = useState<TabType>(initialTab);

  // Use specific user's data instead of current user's data
  const { data: userFollowing, isPending: isPendingUserFollowing } =
    useUserFollowing({ userId });
  const { data: userFollowers, isPending: isPendingUserFollowers } =
    useUserFollowers({ userId });
  const { data: myFollowing } = useFollowing();
  const followingIds = new Set(myFollowing?.map((f) => f.user.id) ?? []);

  const renderFollowUser = ({ item }: { item: FollowUser }) => (
    <FollowUserRow
      user={item.user}
      isFollowing={followingIds.has(item.user.id)}
      showFollowButton={item.user.id !== currentUserId}
      onUserPress={() => {
        navigation.navigate("UserProfile", { userId: item.user.id });
      }}
    />
  );

  const renderTab = (tab: TabType, title: string, count?: number) => {
    const isActive = activeTab === tab;
    return (
      <Text
        type={isActive ? "highlight" : "bodyFaded"}
        style={[styles.tabText, isActive && styles.activeTab]}
        onPress={() => setActiveTab(tab)}
      >
        {title}
        {count !== undefined && ` (${count})`}
      </Text>
    );
  };

  const renderContent = () => {
    switch (activeTab) {
      case "following":
        if (isPendingUserFollowing) {
          return (
            <View style={styles.centered}>
              <ActivityIndicator size="large" />
            </View>
          );
        }

        if (!userFollowing || userFollowing.length === 0) {
          return (
            <View style={styles.emptyState}>
              <Text type="bodyFaded">
                {userName} isn't following anyone yet
              </Text>
            </View>
          );
        }

        return (
          <FlatList
            data={userFollowing}
            renderItem={renderFollowUser}
            keyExtractor={(item) => item.followId.toString()}
            ItemSeparatorComponent={UserSeparator}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
          />
        );

      case "followers":
        if (isPendingUserFollowers) {
          return (
            <View style={styles.centered}>
              <ActivityIndicator size="large" />
            </View>
          );
        }

        if (!userFollowers || userFollowers.length === 0) {
          return (
            <View style={styles.emptyState}>
              <Text type="bodyFaded">{userName} has no followers yet</Text>
            </View>
          );
        }

        return (
          <FlatList
            data={userFollowers}
            renderItem={renderFollowUser}
            keyExtractor={(item) => item.followId.toString()}
            ItemSeparatorComponent={UserSeparator}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
          />
        );
    }
  };

  return (
    <View style={styles.screen}>
      <SafeAreaView style={styles.container}>
        <NavigationHeader title={userName} />

        {/* Tabs */}
        <View style={styles.tabs}>
          {renderTab("following", "Following", userFollowing?.length)}
          {renderTab("followers", "Followers", userFollowers?.length)}
        </View>

        <VSpace size={20} />

        <View style={styles.content}>{renderContent()}</View>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  container: {
    flex: 1,
  },
  tabs: {
    marginHorizontal: 20,
    flexDirection: "row",
    justifyContent: "space-around",
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  tabText: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: theme.colors.primary,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  listContent: {
    paddingBottom: 24,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 40,
  },
  emptySubtext: {
    marginTop: 8,
    textAlign: "center",
  },
}));
