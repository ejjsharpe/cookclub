import { View, TouchableOpacity } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Avatar } from "./Avatar";
import { HSpace } from "./Space";
import { Text } from "./Text";

interface User {
  id: string;
  name: string;
  username?: string | null;
  image?: string | null;
  subscriptionTier?: string | null;
}

interface Props {
  user: User;
  onPress?: () => void;
}

export const UserCard = ({ user, onPress }: Props) => {
  const userMeta = user.username ? `@${user.username}` : "Cook Club member";

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <Avatar
        imageUrl={user.image}
        name={user.name}
        size={44}
        subscriptionTier={user.subscriptionTier}
      />

      <HSpace size={12} />

      <View style={styles.info}>
        <Text type="heading" numberOfLines={1}>
          {user.name}
        </Text>
        <Text type="bodyFaded" numberOfLines={1} style={styles.meta}>
          {userMeta}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create((theme) => ({
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.medium,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 12,
    marginVertical: 4,
  },
  info: {
    flex: 1,
  },
  meta: {
    fontSize: 14,
    marginTop: 2,
  },
}));
