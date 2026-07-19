import { Image } from "expo-image";
import { ActivityIndicator, Pressable, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Ionicons } from "./Ionicons";
import { Text } from "./Text";

interface InvitationBannerProps {
  inviterName: string;
  inviterImage?: string | null;
  resourceName: string;
  onAccept: () => void;
  onDecline: () => void;
  isAccepting?: boolean;
  isDeclining?: boolean;
}

export const InvitationBanner = ({
  inviterName,
  inviterImage,
  resourceName,
  onAccept,
  onDecline,
  isAccepting,
  isDeclining,
}: InvitationBannerProps) => {
  const isPending = isAccepting || isDeclining;

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {inviterImage ? (
          <Image source={{ uri: inviterImage }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Ionicons name="person" size={16} style={styles.avatarIcon} />
          </View>
        )}
        <View style={styles.textContainer}>
          <Text type="body" style={styles.message}>
            <Text type="highlight">{inviterName}</Text> invited you to{" "}
            <Text type="highlight">{resourceName}</Text>
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Pressable
          style={styles.declineButton}
          onPress={onDecline}
          disabled={isPending}
        >
          {isDeclining ? (
            <ActivityIndicator size="small" />
          ) : (
            <Text type="body" style={styles.declineText}>
              Decline
            </Text>
          )}
        </Pressable>
        <Pressable
          style={styles.acceptButton}
          onPress={onAccept}
          disabled={isPending}
        >
          {isAccepting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text type="body" style={styles.acceptText}>
              Accept
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create((theme) => ({
  container: {
    backgroundColor: theme.colors.inputBackground,
    borderRadius: theme.borderRadius.medium,
    padding: 14,
    marginHorizontal: 16,
    marginVertical: 8,
    gap: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.border,
  },
  avatarPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  avatarIcon: {
    color: theme.colors.textSecondary,
  },
  textContainer: {
    flex: 1,
  },
  message: {
    lineHeight: 20,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  declineButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: theme.borderRadius.medium,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
  },
  declineText: {
    color: theme.colors.textSecondary,
  },
  acceptButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: theme.borderRadius.medium,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
  },
  acceptText: {
    color: "#fff",
  },
}));
