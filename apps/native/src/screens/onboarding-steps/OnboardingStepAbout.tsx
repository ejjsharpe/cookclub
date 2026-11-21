import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRef } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  View,
  type TextInputInstance,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Avatar } from "@/components/Avatar";
import { Input } from "@/components/Input";
import { SystemIcon } from "@/components/SystemIcon";
import { Text } from "@/components/Text";
import { CommentOptionsMenu } from "@/components/comment-options/CommentOptionsMenu";
import { GlassSurface } from "@/components/glass/Glass";
import type { MeasurementSystem } from "@/lib/measurementPreferences";
import { ensureMediaLibraryPermission } from "@/utils/imagePickerPermissions";

const PHOTO = 84;

const UNIT_LABELS: Record<MeasurementSystem, string> = {
  metric: "Metric",
  imperial: "Imperial",
  auto: "As written",
};

interface Props {
  name: string;
  setName: (name: string) => void;
  username: string;
  setUsername: (username: string) => void;
  profileImage: string | null;
  setProfileImage: (uri: string) => void;
  existingImage?: string | null;
  units: MeasurementSystem;
  setUnits: (units: MeasurementSystem) => void;
  isCheckingUsername: boolean;
  isUsernameAvailable: boolean | undefined;
  usernameError: string | null;
  /** The availability check itself failed (e.g. offline). */
  checkFailed: boolean;
  showErrors: boolean;
}

/**
 * Step 1: how other cooks will see you. Photo, name and username, with
 * units as a quiet row since most people never change them.
 */
export const OnboardingStepAbout = ({
  name,
  setName,
  username,
  setUsername,
  profileImage,
  setProfileImage,
  existingImage,
  units,
  setUnits,
  isCheckingUsername,
  isUsernameAvailable,
  usernameError,
  checkFailed,
  showErrors,
}: Props) => {
  const { theme } = useUnistyles();
  const usernameRef = useRef<TextInputInstance>(null);

  const pickPhoto = async () => {
    const allowed = await ensureMediaLibraryPermission({
      message: "Allow access to your photos to add a profile photo.",
    });
    if (!allowed) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      const asset = result.canceled ? undefined : result.assets[0];
      if (asset) setProfileImage(asset.uri);
    } catch {
      Alert.alert("Couldn't open your photos", "Please try again.");
    }
  };

  const usernameStatus =
    username.length < 3 ? null : isCheckingUsername ? (
      <ActivityIndicator size="small" />
    ) : isUsernameAvailable ? (
      <SystemIcon
        sf="checkmark.circle.fill"
        android="checkmark-circle"
        size={18}
        color="#34C759"
      />
    ) : null;

  const usernameMessage =
    username.length >= 3 && checkFailed
      ? (usernameError ?? undefined)
      : username.length >= 3 &&
          !isCheckingUsername &&
          isUsernameAvailable === false
        ? (usernameError ?? "That username is taken.")
        : showErrors && username.length < 3
          ? "Use at least 3 characters."
          : undefined;

  return (
    <View>
      <Text style={styles.title} accessibilityRole="header">
        About you
      </Text>
      <Text style={styles.subtitle}>How other cooks will see you.</Text>

      <Pressable
        onPress={pickPhoto}
        style={styles.photo}
        accessibilityRole="button"
        accessibilityLabel={
          profileImage || existingImage
            ? "Change profile photo"
            : "Add a profile photo"
        }
      >
        {profileImage ? (
          <Image source={{ uri: profileImage }} style={styles.photoImage} />
        ) : (
          <Avatar imageUrl={existingImage} name={name || "?"} size={PHOTO} />
        )}
        <GlassSurface style={styles.camera} contentStyle={styles.cameraInner}>
          <SystemIcon
            sf="camera.fill"
            android="camera"
            size={14}
            color={theme.colors.text}
          />
        </GlassSurface>
      </Pressable>

      <Input
        value={name}
        onChangeText={setName}
        placeholder="Name"
        accessibilityLabel="Name"
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => usernameRef.current?.focus()}
        error={showErrors && !name.trim() ? "Add your name." : undefined}
      />
      <Input
        ref={usernameRef}
        value={username}
        onChangeText={(text) =>
          setUsername(text.toLowerCase().replace(/[^a-z0-9_]/g, ""))
        }
        placeholder="username"
        accessibilityLabel="Username"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username-new"
        textContentType="username"
        rightElement={usernameStatus}
        error={usernameMessage}
      />

      <CommentOptionsMenu
        accessibilityLabel={`Units, ${UNIT_LABELS[units]}`}
        options={(Object.keys(UNIT_LABELS) as MeasurementSystem[]).map(
          (value) => ({
            key: value,
            // Android's menu has no icons, so mark the current one in text
            label:
              Platform.OS === "android" && value === units
                ? `${UNIT_LABELS[value]} ✓`
                : UNIT_LABELS[value],
            systemImage: value === units ? "checkmark" : undefined,
            run: () => setUnits(value),
          }),
        )}
      >
        <View
          style={styles.unitsRow}
          accessible
          accessibilityRole="button"
          accessibilityLabel={`Units, ${UNIT_LABELS[units]}`}
          accessibilityHint="Opens a menu"
        >
          <Text style={styles.unitsLabel}>Units</Text>
          <Text style={styles.unitsValue}>{UNIT_LABELS[units]}</Text>
          <SystemIcon
            sf="chevron.up.chevron.down"
            android="chevron-expand"
            size={13}
            color={theme.colors.textSecondary}
          />
        </View>
      </CommentOptionsMenu>
    </View>
  );
};

const styles = StyleSheet.create((theme, rt) => ({
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontFamily: theme.fonts.black,
    letterSpacing: -0.8,
    color: theme.colors.text,
  },
  subtitle: {
    marginTop: 6,
    fontSize: 16,
    lineHeight: 21,
    color: theme.colors.textSecondary,
  },
  photo: {
    alignSelf: "center",
    marginTop: 32,
    marginBottom: 28,
  },
  photoImage: {
    width: PHOTO,
    height: PHOTO,
    borderRadius: PHOTO / 2,
  },
  camera: {
    position: "absolute",
    right: -4,
    bottom: -2,
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  cameraInner: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  unitsRow: {
    // The menu sizes itself to this row, so it needs a real width
    width: rt.screen.width - 48,
    marginTop: 6,
    height: 48,
    paddingHorizontal: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  unitsLabel: {
    flex: 1,
    fontSize: 16,
    color: theme.colors.text,
  },
  unitsValue: {
    fontSize: 16,
    color: theme.colors.textSecondary,
  },
}));
