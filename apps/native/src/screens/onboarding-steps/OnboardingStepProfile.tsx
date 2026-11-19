import * as ImagePicker from "expo-image-picker";
import {
  View,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
} from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";

import { Input } from "@/components/Input";
import { Ionicons } from "@/components/Ionicons";
import { VSpace } from "@/components/Space";
import { Text } from "@/components/Text";
import { ensureMediaLibraryPermission } from "@/utils/imagePickerPermissions";

interface Props {
  name: string;
  setName: (name: string) => void;
  bio: string;
  setBio: (bio: string) => void;
  profileImage: string | null;
  setProfileImage: (image: string | null) => void;
  existingName?: string;
  existingImage?: string | null;
  username: string;
  setUsername: (username: string) => void;
  isUsernameAvailable: boolean | undefined;
  isCheckingUsername: boolean;
  usernameError: string | null;
  hasAttemptedSubmit: boolean;
}

export const OnboardingStepProfile = ({
  name,
  setName,
  bio,
  setBio,
  profileImage,
  setProfileImage,
  existingName = "",
  existingImage = null,
  username,
  setUsername,
  isUsernameAvailable,
  isCheckingUsername,
  usernameError,
  hasAttemptedSubmit,
}: Props) => {
  const handlePickImage = async () => {
    const hasPermission = await ensureMediaLibraryPermission({
      message: "Please allow access to your photos to set a profile picture.",
    });
    if (!hasPermission) return;

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setProfileImage(result.assets[0].uri);
      }
    } catch (error) {
      console.error("Failed to pick profile image:", error);
      Alert.alert("Photo Error", "Unable to open your photo library.");
    }
  };

  const handleUsernameChange = (text: string) => {
    // Auto-lowercase and strip invalid chars
    const cleaned = text.toLowerCase().replace(/[^a-z0-9_]/g, "");
    setUsername(cleaned);
  };

  const displayImage = profileImage || existingImage;
  const displayInitial = (name || existingName || "?").charAt(0).toUpperCase();

  const showUsernameStatus = username.length >= 3;

  return (
    <View style={styles.container}>
      <Text type="title2" style={styles.title}>
        Set up your profile
      </Text>
      <VSpace size={6} />
      <Text type="bodyFaded" style={styles.subtitle}>
        Choose a username and add the details other cooks will see.
      </Text>
      <VSpace size={24} />

      <View style={styles.centered}>
        <TouchableOpacity
          onPress={handlePickImage}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Choose profile photo"
        >
          <View style={styles.avatarContainer}>
            {displayImage ? (
              <Image source={{ uri: displayImage }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text type="title1" style={styles.avatarText}>
                  {displayInitial}
                </Text>
              </View>
            )}
            <View style={styles.editBadge}>
              <Ionicons name="camera" size={15} style={styles.editIcon} />
            </View>
          </View>
        </TouchableOpacity>
        <VSpace size={8} />
        <Text type="caption" style={styles.photoHint}>
          Profile photo
        </Text>
      </View>

      <VSpace size={24} />

      <View style={styles.form}>
        <View>
          <Input
            label="Username"
            value={username}
            onChangeText={handleUsernameChange}
            placeholder="your_username"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {hasAttemptedSubmit && username.length < 3 && (
            <Animated.View
              entering={FadeIn.duration(200)}
              exiting={FadeOut.duration(150)}
              style={styles.fieldHint}
            >
              <Text style={styles.usernameUnavailable}>
                Must be at least 3 characters
              </Text>
            </Animated.View>
          )}
          {showUsernameStatus && (
            <View style={styles.usernameStatus}>
              {isCheckingUsername ? (
                <ActivityIndicator size="small" />
              ) : isUsernameAvailable ? (
                <Text style={styles.usernameAvailable}>Available</Text>
              ) : (
                <Text style={styles.usernameUnavailable}>
                  {usernameError ?? "Unavailable"}
                </Text>
              )}
            </View>
          )}
        </View>

        <View>
          <Input
            label="Display name"
            value={name}
            onChangeText={setName}
            placeholder="Enter your name"
            autoCapitalize="words"
          />
          {hasAttemptedSubmit && name.trim().length === 0 && (
            <Animated.View
              entering={FadeIn.duration(200)}
              exiting={FadeOut.duration(150)}
              style={styles.fieldHint}
            >
              <Text style={styles.usernameUnavailable}>Required</Text>
            </Animated.View>
          )}
        </View>

        <Input
          label="Bio (optional)"
          value={bio}
          onChangeText={setBio}
          placeholder="Add a short bio"
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          style={styles.bioInput}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
  },
  title: {
    textAlign: "left",
    letterSpacing: -1,
    paddingHorizontal: 2,
  },
  subtitle: {
    paddingHorizontal: 2,
  },
  centered: {
    alignItems: "center",
  },
  avatarContainer: {
    position: "relative",
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
  },
  avatarPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: theme.colors.primary + "20",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: {
    color: theme.colors.primary,
    fontSize: 48,
    lineHeight: 58,
    includeFontPadding: false,
    textAlign: "center",
  },
  editBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.primary,
    backgroundImage: theme.colors.primaryGradient,
    borderWidth: 3,
    borderColor: theme.colors.background,
    justifyContent: "center",
    alignItems: "center",
  },
  editIcon: {
    color: theme.colors.buttonText,
  },
  photoHint: {
    textAlign: "center",
  },
  form: {
    gap: 14,
  },
  bioInput: {
    height: 84,
    paddingTop: 12,
  },
  usernameStatus: {
    marginTop: 6,
    marginLeft: 16,
    flexDirection: "row",
    alignItems: "center",
  },
  usernameAvailable: {
    color: "#34C759",
    fontSize: 13,
    fontFamily: theme.fonts.medium,
  },
  usernameUnavailable: {
    color: theme.colors.destructive,
    fontSize: 13,
    fontFamily: theme.fonts.medium,
  },
  fieldHint: {
    marginTop: 6,
    marginLeft: 16,
  },
}));
