import { useEffect, useState } from "react";
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
  /** Replaces the @username line, e.g. "@sam · 12 recipes". */
  subtitle?: string;
  style?: StyleProp<ViewStyle>;
}

export function FollowUserRow({
  user,
  isFollowing: isFollowingServer,
  onUserPress,
  showFollowButton = true,
  subtitle,
  style,
}: FollowUserRowProps) {
  const [optimisticFollowing, setOptimisticFollowing] = useState<
    boolean | null
  >(null);
  const followMutation = useFollowUser();
  const unfollowMutation = useUnfollowUser();

  const isFollowing = optimisticFollowing ?? isFollowingServer;
  const isPending = followMutation.isPending || unfollowMutation.isPending;

  useEffect(() => {
    if (
      optimisticFollowing !== null &&
      optimisticFollowing === isFollowingServer
    ) {
      setOptimisticFollowing(null);
    }
  }, [isFollowingServer, optimisticFollowing]);

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
          <Text type="subheadline" numberOfLines={1} style={styles.name}>
            {user.name}
          </Text>
          {(subtitle ?? user.username) ? (
            <Text type="footnote" numberOfLines={1} style={styles.username}>
              {subtitle ?? `@${user.username}`}
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
    paddingVertical: 10,
    gap: 12,
  },
  userInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  nameContainer: {
    flex: 1,
    gap: 1,
  },
  name: {
    fontSize: 16,
    fontFamily: theme.fonts.bold,
  },
  username: {
    color: theme.colors.textSecondary,
  },
  // Follow is a soft Paprika pill; Following steps back to grey so a list of
  // people you already follow stays calm.
  followButton: {
    height: 32,
    minWidth: 88,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: theme.colors.primarySoft,
  },
  followingButton: {
    backgroundColor: theme.colors.inputBackground,
  },
  followButtonText: {
    color: theme.colors.onPrimarySoft,
    fontFamily: theme.fonts.bold,
    fontSize: 14,
    lineHeight: 18,
  },
  followingButtonText: {
    color: theme.colors.textSecondary,
  },
}));
