import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

interface NotificationBadgeProps {
  count: number;
}

/**
 * A small unread dot on the notifications bell. The count itself belongs in
 * the button's accessibility label, not on the icon.
 */
export const NotificationBadge = ({ count }: NotificationBadgeProps) => {
  if (count <= 0) {
    return null;
  }

  return <View style={styles.dot} pointerEvents="none" />;
};

const styles = StyleSheet.create((theme) => ({
  dot: {
    position: "absolute",
    top: 0,
    right: 1,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.primary,
    backgroundImage: theme.colors.primaryGradient,
  },
}));
