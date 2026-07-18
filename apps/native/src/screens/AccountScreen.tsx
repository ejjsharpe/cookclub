import { useNavigation } from "@react-navigation/native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useState, useEffect } from "react";
import {
  View,
  Alert,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";

import { useUser, useUpdateProfile, useCheckUsername } from "@/api/user";
import { Input } from "@/components/Input";
import { NavigationHeader } from "@/components/NavigationHeader";
import { SafeAreaView } from "@/components/SafeAreaView";
import { VSpace } from "@/components/Space";
import { Text } from "@/components/Text";
import { PrimaryButton } from "@/components/buttons/PrimaryButton";
import { useAvatarUpload } from "@/hooks/useAvatarUpload";
import { alertApiError } from "@/lib/apiErrorAlert";
import { authClient } from "@/lib/authClient";
import { ensureMediaLibraryPermission } from "@/utils/imagePickerPermissions";
import { appendImageVersion, getImageUrl } from "@/utils/imageUrl";

export const AccountScreen = () => {
  const navigation = useNavigation();
  const { data: currentUser } = useUser();
  const { mutateAsync: updateProfile, isPending: isUpdating } =
    useUpdateProfile();
  const insets = UnistylesRuntime.insets;

  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [localImage, setLocalImage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const {
    upload: uploadAvatar,
    isUploading: isUploadingAvatar,
    progress: uploadProgress,
  } = useAvatarUpload();

  const { data: usernameCheck, isFetching: isCheckingUsername } =
    useCheckUsername(username);

  useEffect(() => {
    if (currentUser?.user) {
      setUsername(currentUser.user.username ?? "");
      setName(currentUser.user.name);
      setEmail(currentUser.user.email);
    }
  }, [currentUser?.user]);

  const originalUsername = currentUser?.user?.username ?? "";
  const originalName = currentUser?.user?.name ?? "";
  const originalEmail = currentUser?.user?.email ?? "";
  const userImage = currentUser?.user?.image;
  const userInitial = (name || originalName || "?").charAt(0).toUpperCase();
  const remoteImage = getImageUrl(
    appendImageVersion(userImage, currentUser?.user?.updatedAt),
    "avatar-lg",
  );
  const displayImage = localImage ?? remoteImage;

  const usernameChanged = username !== originalUsername;
  const nameChanged = name !== originalName;
  const emailChanged = email !== originalEmail;
  const imageChanged = localImage !== null;
  const hasChanges =
    usernameChanged || nameChanged || emailChanged || imageChanged;
  const isSaving = isSubmitting || isUpdating || isUploadingAvatar;

  const isUsernameValid =
    !usernameChanged ||
    (username.length >= 3 && usernameCheck?.available !== false);

  const handleUsernameChange = (text: string) => {
    const cleaned = text.toLowerCase().replace(/[^a-z0-9_]/g, "");
    setUsername(cleaned);
  };

  const showUsernameStatus = usernameChanged && username.length >= 3;

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
        setLocalImage(result.assets[0].uri);
      }
    } catch (error) {
      console.error("Failed to pick profile image:", error);
      Alert.alert("Photo Error", "Unable to open your photo library.");
    }
  };

  const handleSave = async () => {
    if (!hasChanges) return;

    if (usernameChanged && !isUsernameValid) {
      Alert.alert(
        "Invalid Username",
        usernameCheck?.reason ?? "Please choose a valid username.",
      );
      return;
    }

    if (nameChanged && name.trim().length === 0) {
      Alert.alert("Invalid Name", "Display name cannot be empty.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (localImage) {
        await uploadAvatar(localImage);
      }

      // Update username and/or name via tRPC
      if (usernameChanged || nameChanged) {
        await updateProfile({
          ...(usernameChanged && { username }),
          ...(nameChanged && { name: name.trim() }),
        });
      }

      // Change email via Better Auth
      if (emailChanged) {
        const changeEmailResult = await authClient.changeEmail({
          newEmail: email,
        });
        if (changeEmailResult.error) {
          alertApiError("Email Change Failed", changeEmailResult.error, {
            operation: "auth.changeEmail",
            fallback: "Failed to change your email. Please try again.",
          });
          return;
        }
        Alert.alert(
          "Verification Sent",
          "A verification email has been sent to your new address. Please check your inbox.",
          [{ text: "OK", onPress: () => navigation.goBack() }],
        );
        return;
      }

      navigation.goBack();
    } catch (error: unknown) {
      alertApiError("Save Failed", error, {
        operation: "account.save",
        fallback: "Failed to save changes. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.screen}>
      <SafeAreaView edges={["top"]} style={styles.container}>
        <NavigationHeader title="Account" />

        <ScrollView
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
          keyboardShouldPersistTaps="handled"
        >
          <VSpace size={24} />

          <TouchableOpacity
            onPress={handlePickImage}
            activeOpacity={0.7}
            disabled={isSaving}
            accessibilityRole="button"
            accessibilityLabel="Choose profile photo"
            style={styles.avatarButton}
          >
            <View style={styles.avatarContainer}>
              {displayImage ? (
                <Image source={{ uri: displayImage }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Text type="largeTitle" style={styles.avatarText}>
                    {userInitial}
                  </Text>
                </View>
              )}
              {isUploadingAvatar ? (
                <View style={styles.uploadingOverlay}>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={styles.uploadingText}>{uploadProgress}%</Text>
                </View>
              ) : (
                <View style={styles.editOverlay}>
                  <Text style={styles.editOverlayText}>Edit</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>

          <VSpace size={32} />

          {/* Username */}
          <View>
            <Input
              label="Username"
              value={username}
              onChangeText={handleUsernameChange}
              placeholder="your_username"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isSaving}
            />
            {showUsernameStatus && (
              <View style={styles.fieldStatus}>
                {isCheckingUsername ? (
                  <ActivityIndicator size="small" />
                ) : usernameCheck?.available ? (
                  <Animated.View
                    entering={FadeIn.duration(200)}
                    exiting={FadeOut.duration(150)}
                  >
                    <Text style={styles.available}>Available</Text>
                  </Animated.View>
                ) : (
                  <Animated.View
                    entering={FadeIn.duration(200)}
                    exiting={FadeOut.duration(150)}
                  >
                    <Text style={styles.unavailable}>
                      {usernameCheck?.reason ?? "Unavailable"}
                    </Text>
                  </Animated.View>
                )}
              </View>
            )}
          </View>

          <VSpace size={16} />

          {/* Display Name */}
          <Input
            label="Display name"
            value={name}
            onChangeText={setName}
            placeholder="Enter your name"
            autoCapitalize="words"
            editable={!isSaving}
          />

          <VSpace size={16} />

          {/* Email */}
          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="your@email.com"
            autoCapitalize="none"
            keyboardType="email-address"
            editable={!isSaving}
          />
          {emailChanged && (
            <Animated.View
              entering={FadeIn.duration(200)}
              exiting={FadeOut.duration(150)}
              style={styles.fieldHint}
            >
              <Text type="caption" style={styles.hintText}>
                A verification email will be sent to your new address
              </Text>
            </Animated.View>
          )}

          <VSpace size={32} />

          <PrimaryButton
            onPress={handleSave}
            disabled={
              !hasChanges || isSaving || (usernameChanged && !isUsernameValid)
            }
          >
            {isSaving ? "Saving..." : "Save Changes"}
          </PrimaryButton>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: 20,
  },
  avatarButton: {
    alignSelf: "center",
  },
  avatarContainer: {
    position: "relative",
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: theme.colors.primary + "20",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: {
    color: theme.colors.primary,
  },
  editOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    paddingVertical: 6,
    borderBottomLeftRadius: 50,
    borderBottomRightRadius: 50,
    alignItems: "center",
  },
  editOverlayText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  uploadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    borderRadius: 50,
    justifyContent: "center",
    alignItems: "center",
  },
  uploadingText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 4,
  },
  fieldStatus: {
    marginTop: 6,
    marginLeft: 16,
    flexDirection: "row",
    alignItems: "center",
  },
  available: {
    color: "#34C759",
    fontSize: 13,
    fontFamily: theme.fonts.medium,
  },
  unavailable: {
    color: theme.colors.destructive,
    fontSize: 13,
    fontFamily: theme.fonts.medium,
  },
  fieldHint: {
    marginTop: 6,
    marginLeft: 16,
  },
  hintText: {
    color: theme.colors.textSecondary,
  },
}));
