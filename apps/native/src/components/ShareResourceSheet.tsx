import { TrueSheet } from "@lodev09/react-native-true-sheet";
import { Image } from "expo-image";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";

import { AppSheet } from "./AppSheet";
import { Ionicons } from "./Ionicons";
import { VSpace } from "./Space";
import { Text } from "./Text";

type FriendState = "none" | "invited" | "shared";

interface ShareableFriend {
  id: string;
  name: string;
  image?: string | null;
}

export interface ShareResourceSheetRef {
  present: () => void;
  dismiss: () => void;
}

interface ShareResourceSheetProps {
  title: string;
  subtitle?: string;
  resourceLabel: string;
  resourcePlural: string;
  friends?: ShareableFriend[];
  sharedUserIds?: string[];
  invitedUserIds?: string[];
  isLoading: boolean;
  onInvite: (userId: string) => Promise<unknown>;
  onCancelInvitation: (userId: string) => Promise<unknown>;
  onRemoveMember: (userId: string) => Promise<unknown>;
}

interface FriendItemProps {
  friend: ShareableFriend;
  state: FriendState;
  resourceLabel: string;
  onInvite: () => void;
  onCancelInvitation: () => void;
  onRemoveMember: () => void;
  isPending: boolean;
}

const FriendItem = ({
  friend,
  state,
  resourceLabel,
  onInvite,
  onCancelInvitation,
  onRemoveMember,
  isPending,
}: FriendItemProps) => {
  const handlePress = () => {
    if (state === "shared") {
      Alert.alert(
        "Remove Access",
        `Remove ${friend.name}'s access to this ${resourceLabel}?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove Access",
            style: "destructive",
            onPress: onRemoveMember,
          },
        ],
      );
      return;
    }

    if (state === "invited") {
      Alert.alert(
        "Cancel Invitation",
        `Cancel the invitation to ${friend.name}?`,
        [
          { text: "Keep", style: "cancel" },
          {
            text: "Cancel Invitation",
            style: "destructive",
            onPress: onCancelInvitation,
          },
        ],
      );
      return;
    }

    onInvite();
  };

  return (
    <Pressable
      style={styles.friendRow}
      onPress={handlePress}
      disabled={isPending}
    >
      {friend.image ? (
        <Image source={{ uri: friend.image }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarPlaceholder]}>
          <Ionicons name="person" size={20} style={styles.avatarIcon} />
        </View>
      )}
      <View style={styles.friendInfo}>
        <Text type="body">{friend.name}</Text>
        {state === "shared" ? (
          <Text type="caption" style={styles.accessText}>
            Shared
          </Text>
        ) : null}
        {state === "invited" ? (
          <Text type="caption" style={styles.invitedText}>
            Invited
          </Text>
        ) : null}
      </View>
      {isPending ? (
        <ActivityIndicator size="small" />
      ) : state === "shared" ? (
        <Ionicons name="checkmark-circle" size={24} style={styles.sharedIcon} />
      ) : state === "invited" ? (
        <Ionicons name="time-outline" size={24} style={styles.invitedIcon} />
      ) : (
        <Ionicons name="add-circle-outline" size={24} style={styles.addIcon} />
      )}
    </Pressable>
  );
};

export const ShareResourceSheet = forwardRef<
  ShareResourceSheetRef,
  ShareResourceSheetProps
>(
  (
    {
      title,
      subtitle,
      resourceLabel,
      resourcePlural,
      friends,
      sharedUserIds = [],
      invitedUserIds = [],
      isLoading,
      onInvite,
      onCancelInvitation,
      onRemoveMember,
    },
    ref,
  ) => {
    const theme = UnistylesRuntime.getTheme();
    const sheetRef = useRef<TrueSheet>(null);
    const [pendingUserId, setPendingUserId] = useState<string | null>(null);
    const sharedIds = new Set(sharedUserIds);
    const invitedIds = new Set(invitedUserIds);

    useImperativeHandle(ref, () => ({
      present: () => sheetRef.current?.present(),
      dismiss: () => sheetRef.current?.dismiss(),
    }));

    const runForUser = useCallback(
      async (userId: string, operation: (id: string) => Promise<unknown>) => {
        setPendingUserId(userId);
        try {
          await operation(userId);
        } catch {
          // Mutation hooks own user-facing error handling.
        } finally {
          setPendingUserId(null);
        }
      },
      [],
    );

    const getFriendState = (userId: string): FriendState => {
      if (sharedIds.has(userId)) return "shared";
      if (invitedIds.has(userId)) return "invited";
      return "none";
    };

    const hasFriends = Boolean(friends?.length);

    return (
      <AppSheet
        ref={sheetRef}
        title={title}
        subtitle={subtitle}
        detents={[0.8]}
        backgroundColor={theme.colors.background}
        scrollable
      >
        <View>
          <ScrollView style={styles.scrollView}>
            <View style={styles.scrollContent}>
              {isLoading ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" />
                </View>
              ) : !hasFriends ? (
                <View style={styles.emptyContainer}>
                  <Ionicons
                    name="people-outline"
                    size={48}
                    style={styles.emptyIcon}
                  />
                  <Text type="bodyFaded" style={styles.emptyText}>
                    You don&apos;t have any friends to share with yet. Follow
                    other users and have them follow you back to share{" "}
                    {resourcePlural}!
                  </Text>
                </View>
              ) : (
                <>
                  {(sharedUserIds.length > 0 || invitedUserIds.length > 0) && (
                    <View style={styles.sharedSummary}>
                      <Ionicons
                        name="people"
                        size={18}
                        style={styles.summaryIcon}
                      />
                      <Text type="body">
                        {sharedUserIds.length > 0
                          ? `Shared with ${sharedUserIds.length} ${sharedUserIds.length === 1 ? "person" : "people"}`
                          : ""}
                        {sharedUserIds.length > 0 && invitedUserIds.length > 0
                          ? " · "
                          : ""}
                        {invitedUserIds.length > 0
                          ? `${invitedUserIds.length} pending`
                          : ""}
                      </Text>
                    </View>
                  )}

                  <Text type="heading" style={styles.sectionTitle}>
                    Friends
                  </Text>
                  <VSpace size={12} />

                  {friends?.map((friend) => (
                    <FriendItem
                      key={friend.id}
                      friend={friend}
                      state={getFriendState(friend.id)}
                      resourceLabel={resourceLabel}
                      onInvite={() => {
                        runForUser(friend.id, onInvite);
                      }}
                      onCancelInvitation={() =>
                        runForUser(friend.id, onCancelInvitation)
                      }
                      onRemoveMember={() =>
                        runForUser(friend.id, onRemoveMember)
                      }
                      isPending={pendingUserId === friend.id}
                    />
                  ))}
                </>
              )}
            </View>
          </ScrollView>
        </View>
      </AppSheet>
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  scrollView: { maxHeight: 500 },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 20,
  },
  loadingContainer: { alignItems: "center", paddingVertical: 40 },
  emptyContainer: { alignItems: "center", paddingVertical: 40 },
  emptyIcon: { color: theme.colors.textTertiary, marginBottom: 12 },
  emptyText: { textAlign: "center", paddingHorizontal: 20 },
  sharedSummary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: theme.colors.primary + "15",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: theme.borderRadius.medium,
    marginBottom: 20,
  },
  summaryIcon: { color: theme.colors.primary },
  sectionTitle: { marginBottom: 4 },
  friendRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.inputBackground,
  },
  avatarPlaceholder: { alignItems: "center", justifyContent: "center" },
  avatarIcon: { color: theme.colors.textTertiary },
  friendInfo: { flex: 1, marginLeft: 12 },
  accessText: { color: theme.colors.textSecondary, marginTop: 2 },
  invitedText: { color: "#F59E0B", marginTop: 2 },
  sharedIcon: { color: theme.colors.primary },
  invitedIcon: { color: "#F59E0B" },
  addIcon: { color: theme.colors.textTertiary },
}));
