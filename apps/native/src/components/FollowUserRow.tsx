import { useState } from "react";
import {
  View,
  TouchableOpacity,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { useFollowUser, useUnfollowUser } from "@/api/follows";
import { Avatar } from "@/components/Avatar";
import { Text } from "@/components/Text";

interface FollowUser {
  id: string;
  name: string;
  username?: string | null;
  image?: string | null;
  subscriptionTier?: string | null;
}

interface FollowUserRowProps {
  user: FollowUser;
  isFollowing: boolean;
  onUserPress?: () => void;
  showFollowButton?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function FollowUserRow({
  user,
  isFollowing: isFollowingServer,
  onUserPress,
  showFollowButton = true,
  style,
}: FollowUserRowProps) {
  const [optimisticFollowing, setOptimisticFollowing] = useState<
    boolean | null
  >(null);
  const followMutation = useFollowUser();
  const unfollowMutation = useUnfollowUser();

  const isPending = followMutation.isPending || unfollowMutation.isPending;
  const isFollowing =
    isPending && optimisticFollowing !== null
      ? optimisticFollowing
      : isFollowingServer;

  const handleFollowPress = () => {
    const nextFollowing = !isFollowing;
    setOptimisticFollowing(nextFollowing);

    const options = { onError: () => setOptimisticFollowing(null) };

    if (isFollowing) {
      unfollowMutation.mutate({ userId: user.id }, options);
    } else {
      followMutation.mutate({ userId: user.id }, options);
    }
  };

  return (
    <View style={[styles.userRow, style]}>
      <TouchableOpacity
        style={styles.userInfo}
        onPress={onUserPress}
        disabled={!onUserPress}
        activeOpacity={0.7}
      >
        <Avatar
          imageUrl={user.image}
          name={user.name}
          size={44}
          subscriptionTier={user.subscriptionTier}
        />
        <View style={styles.nameContainer}>
          <Text type="heading" numberOfLines={1}>
            {user.name}
          </Text>
          {user.username ? (
            <Text type="bodyFaded" numberOfLines={1} style={styles.username}>
              @{user.username}
            </Text>
          ) : null}
        </View>
      </TouchableOpacity>

      {showFollowButton ? (
        <TouchableOpacity
          style={[styles.followButton, isFollowing && styles.followingButton]}
          onPress={handleFollowPress}
          disabled={isPending}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${isFollowing ? "Unfollow" : "Follow"} ${user.name}`}
        >
          <Text
            style={[
              styles.followButtonText,
              isFollowing && styles.followingButtonText,
            ]}
          >
            {isFollowing ? "Following" : "Follow"}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 64,
    paddingVertical: 8,
    position: "relative",
  },
  userInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  nameContainer: {
    flex: 1,
  },
  username: {
    fontSize: 13,
    marginTop: 1,
  },
  followButton: {
    minHeight: 30,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: theme.colors.primary,
  },
  followingButton: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  followButtonText: {
    color: theme.colors.buttonText,
    fontFamily: theme.fonts.semiBold,
    fontSize: 13,
    lineHeight: 18,
  },
  followingButtonText: {
    color: theme.colors.text,
  },
}));
