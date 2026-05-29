import { Image } from "expo-image";
import { View, TouchableOpacity } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Text } from "@/components/Text";
import { appendImageVersion, getImageUrl } from "@/utils/imageUrl";

interface AvatarProps {
  imageUrl?: string | null;
  imageVersion?: Date | string | number | null;
  name: string;
  size?: number;
  onPress?: () => void;
}

export const Avatar = ({
  imageUrl,
  imageVersion,
  name,
  size = 44,
  onPress,
}: AvatarProps) => {
  const initial = name.charAt(0).toUpperCase();
  const fontSize = size * 0.36;
  const versionedImageUrl = appendImageVersion(imageUrl, imageVersion);
  const displayImageUrl = getImageUrl(
    versionedImageUrl,
    size > 60 ? "avatar-lg" : "avatar-sm",
  );

  const content = displayImageUrl ? (
    <Image
      source={{ uri: displayImageUrl }}
      style={[styles.image, { width: size, height: size }]}
      cachePolicy="memory-disk"
      transition={100}
    />
  ) : (
    <View style={[styles.placeholder, { width: size, height: size }]}>
      <Text type="heading" style={[styles.initial, { fontSize }]}>
        {initial}
      </Text>
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity
        style={{ width: size, height: size }}
        onPress={onPress}
        activeOpacity={0.7}
      >
        {content}
      </TouchableOpacity>
    );
  }

  return content;
};

const styles = StyleSheet.create((theme) => ({
  image: {
    borderRadius: theme.borderRadius.full,
  },
  placeholder: {
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.primary + "20",
    justifyContent: "center",
    alignItems: "center",
  },
  initial: {
    color: theme.colors.primary,
  },
}));
