import { Image } from "expo-image";
import { View, TouchableOpacity } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Ionicons } from "@/components/Ionicons";
import { Text } from "@/components/Text";
import { getInitials, getPlaceholderColours } from "@/utils/avatarPlaceholder";
import { appendImageVersion, getImageUrl } from "@/utils/imageUrl";

interface AvatarProps {
  imageUrl?: string | null;
  imageVersion?: Date | string | number | null;
  name: string;
  size?: number;
  isPro?: boolean;
  subscriptionTier?: string | null;
  onPress?: () => void;
}

export const Avatar = ({
  imageUrl,
  imageVersion,
  name,
  size = 44,
  isPro = false,
  subscriptionTier,
  onPress,
}: AvatarProps) => {
  const initials = getInitials(name);
  const placeholderColours = getPlaceholderColours(name);
  const fontSize = size * 0.36;
  const proIndicatorSize = Math.max(16, Math.round(size * 0.36));
  const proIconSize = Math.max(9, Math.round(size * 0.2));
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
    <View
      style={[
        styles.placeholder,
        {
          width: size,
          height: size,
          backgroundColor: placeholderColours.background,
        },
      ]}
    >
      <Text
        type="heading"
        style={[
          styles.initial,
          {
            fontSize,
            lineHeight: fontSize * 1.2,
            color: placeholderColours.ink,
          },
        ]}
      >
        {initials}
      </Text>
    </View>
  );

  const showsProIndicator =
    subscriptionTier !== undefined && subscriptionTier !== null
      ? subscriptionTier === "pro"
      : isPro;

  const decoratedContent = showsProIndicator ? (
    <View style={[styles.container, { width: size, height: size }]}>
      {content}
      <View pointerEvents="none" style={styles.proRing} />
      <View
        pointerEvents="none"
        style={[
          styles.proIndicator,
          {
            width: proIndicatorSize,
            height: proIndicatorSize,
            borderRadius: proIndicatorSize / 2,
          },
        ]}
      >
        <Ionicons
          name="sparkles"
          size={proIconSize}
          style={styles.proIndicatorIcon}
        />
      </View>
    </View>
  ) : (
    content
  );

  if (onPress) {
    return (
      <TouchableOpacity
        style={{ width: size, height: size }}
        onPress={onPress}
        activeOpacity={0.7}
      >
        {decoratedContent}
      </TouchableOpacity>
    );
  }

  return decoratedContent;
};

const styles = StyleSheet.create((theme) => ({
  container: {
    position: "relative",
  },
  image: {
    borderRadius: theme.borderRadius.full,
  },
  placeholder: {
    borderRadius: theme.borderRadius.full,
    justifyContent: "center",
    alignItems: "center",
  },
  initial: {
    fontFamily: theme.fonts.bold,
    letterSpacing: 0,
  },
  proRing: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: theme.borderRadius.full,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  proIndicator: {
    position: "absolute",
    right: -2,
    bottom: -2,
    backgroundColor: theme.colors.primary,
    backgroundImage: theme.colors.primaryGradient,
    borderWidth: 2,
    borderColor: theme.colors.background,
    justifyContent: "center",
    alignItems: "center",
  },
  proIndicatorIcon: {
    color: theme.colors.buttonText,
  },
}));
