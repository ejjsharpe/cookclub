import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { useBlockedUsers, useUnblockUser } from "@/api/moderation";
import { Avatar } from "@/components/Avatar";
import { NavigationHeader } from "@/components/NavigationHeader";
import { SafeAreaView } from "@/components/SafeAreaView";
import { Text } from "@/components/Text";
import { alertApiError } from "@/lib/apiErrorAlert";

export function BlockedUsersScreen() {
  const blockedUsers = useBlockedUsers();
  const unblock = useUnblockUser();

  const confirmUnblock = (userId: string, name: string) => {
    Alert.alert(`Unblock ${name}?`, "Previous follows will not be restored.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Unblock",
        onPress: () =>
          unblock.mutate(
            { userId },
            {
              onError: (error) =>
                alertApiError("Unblock Failed", error, {
                  operation: "moderation.unblockUser",
                  fallback: "Could not unblock this user. Please try again.",
                }),
            },
          ),
      },
    ]);
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.container}>
      <NavigationHeader title="Blocked users" />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
      >
        {blockedUsers.isPending ? <ActivityIndicator /> : null}
        {blockedUsers.data?.length === 0 ? (
          <Text type="bodyFaded" style={styles.empty}>
            You have not blocked anyone.
          </Text>
        ) : null}
        {blockedUsers.data?.map((blocked) => (
          <View key={blocked.id} style={styles.row}>
            <Avatar imageUrl={blocked.image} name={blocked.name} size={44} />
            <View style={styles.userCopy}>
              <Text type="headline">{blocked.name}</Text>
              {blocked.username ? (
                <Text type="bodyFaded">@{blocked.username}</Text>
              ) : null}
            </View>
            <Pressable
              disabled={unblock.isPending}
              onPress={() => confirmUnblock(blocked.id, blocked.name)}
              style={styles.unblock}
            >
              <Text style={styles.unblockText}>Unblock</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme, rt) => ({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingBottom: rt.insets.bottom + 20,
    gap: 12,
  },
  empty: { textAlign: "center", paddingVertical: 40 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: theme.borderRadius.large,
    backgroundColor: theme.colors.inputBackground,
  },
  userCopy: { flex: 1, minWidth: 0 },
  unblock: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.background,
  },
  unblockText: {
    color: theme.colors.primary,
    fontFamily: theme.fonts.semiBold,
  },
}));
