import { TrueSheet } from "@lodev09/react-native-true-sheet";
import {
  RECIPE_IMPORT_LIMITS,
  recipeImportSourceImageByteBudget,
  type RecipeImportMode,
} from "@repo/contracts/recipe-import";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { forwardRef, useState, useImperativeHandle, useRef } from "react";
import {
  View,
  TouchableOpacity,
  TextInput,
  Alert,
  ScrollView,
} from "react-native";
import Animated, { FadeIn, LinearTransition } from "react-native-reanimated";
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";

import { createRecipeImportId, useRecipeImport } from "./RecipeImportProvider";

import { AppSheet } from "@/components/AppSheet";
import { Input } from "@/components/Input";
import { Ionicons } from "@/components/Ionicons";
import { VSpace } from "@/components/Space";
import { Text } from "@/components/Text";
import { PrimaryButton } from "@/components/buttons/PrimaryButton";
import {
  ensureCameraPermission,
  ensureMediaLibraryPermission,
} from "@/utils/imagePickerPermissions";

export type SmartImportMode = RecipeImportMode;

type SmartImportAttempt = {
  id: string;
  sourceKey: string;
  uploadsByUri: Map<string, Promise<string>>;
};

const isDarkThemeRuntime = (runtime: {
  themeName?: string;
  colorScheme: string;
}) =>
  runtime.themeName
    ? runtime.themeName === "dark"
    : runtime.colorScheme === "dark";

const ModeOption = ({
  icon,
  label,
  selected,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  selected: boolean;
  onPress: () => void;
}) => (
  <TouchableOpacity
    style={[modeStyles.option, selected && modeStyles.optionSelected]}
    onPress={onPress}
    activeOpacity={0.7}
  >
    <View
      style={[
        modeStyles.iconContainer,
        selected && modeStyles.iconContainerSelected,
      ]}
    >
      <Ionicons
        name={icon}
        size={18}
        style={selected ? modeStyles.iconSelected : modeStyles.icon}
      />
    </View>
    <Text
      type="subheadline"
      style={selected ? modeStyles.labelSelected : modeStyles.label}
    >
      {label}
    </Text>
  </TouchableOpacity>
);

const modeStyles = StyleSheet.create((theme, runtime) => {
  const isDarkTheme = isDarkThemeRuntime(runtime);
  const optionColor = isDarkTheme
    ? theme.colors.text
    : theme.colors.textSecondary;
  const selectedLabelColor = theme.colors.primary;

  return {
    option: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      height: 50,
      borderRadius: theme.borderRadius.full,
      backgroundColor: theme.colors.inputBackground,
      gap: 8,
    },
    optionSelected: {
      backgroundColor: theme.colors.primary + "20",
    },
    iconContainer: {
      width: 28,
      height: 28,
      borderRadius: theme.borderRadius.full,
      backgroundColor: theme.colors.background,
      justifyContent: "center",
      alignItems: "center",
    },
    iconContainerSelected: {
      backgroundColor: theme.colors.primary + "30",
    },
    icon: {
      color: optionColor,
    },
    iconSelected: {
      color: theme.colors.primary,
    },
    label: {
      color: optionColor,
    },
    labelSelected: {
      color: selectedLabelColor,
      fontWeight: "500",
    },
  };
});

export interface SmartImportSheetRef {
  present: () => void;
  dismiss: () => void;
}

export const SmartImportSheet = forwardRef<SmartImportSheetRef>((_, ref) => {
  const theme = UnistylesRuntime.getTheme();
  const sheetRef = useRef<TrueSheet>(null);
  const { submitImport, uploadImportSource } = useRecipeImport();
  const [mode, setMode] = useState<SmartImportMode>("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [imageUris, setImageUris] = useState<string[]>([]);
  const [isStarting, setIsStarting] = useState(false);
  const importAttemptRef = useRef<SmartImportAttempt | null>(null);

  useImperativeHandle(ref, () => ({
    present: () => sheetRef.current?.present(),
    dismiss: () => sheetRef.current?.dismiss(),
  }));

  const handleClose = () => {
    sheetRef.current?.dismiss();
  };

  const handleDidDismiss = () => {
    importAttemptRef.current = null;
    setUrl("");
    setText("");
    setImageUris([]);
    setIsStarting(false);
  };

  const getImportAttempt = (sourceKey: string): SmartImportAttempt => {
    if (importAttemptRef.current?.sourceKey === sourceKey) {
      return importAttemptRef.current;
    }
    const attempt: SmartImportAttempt = {
      id: createRecipeImportId(),
      sourceKey,
      uploadsByUri: new Map(),
    };
    importAttemptRef.current = attempt;
    return attempt;
  };

  const handlePickImages = async () => {
    const availableSlots = RECIPE_IMPORT_LIMITS.sourceImages - imageUris.length;
    if (availableSlots <= 0) return;

    const hasPermission = await ensureMediaLibraryPermission({
      message: "Please allow access to your photos to upload recipe images.",
    });
    if (!hasPermission) return;

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        allowsMultipleSelection: true,
        orderedSelection: true,
        selectionLimit: availableSlots,
        quality: 0.8,
      });

      if (!result.canceled) {
        setImageUris((current) =>
          Array.from(
            new Set([...current, ...result.assets.map((asset) => asset.uri)]),
          ).slice(0, RECIPE_IMPORT_LIMITS.sourceImages),
        );
      }
    } catch (error) {
      console.error("Failed to pick recipe import image:", error);
      Alert.alert("Photo Error", "Unable to open your photo library.");
    }
  };

  const handleTakePhoto = async () => {
    if (imageUris.length >= RECIPE_IMPORT_LIMITS.sourceImages) return;

    const hasPermission = await ensureCameraPermission();
    if (!hasPermission) return;

    try {
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        const capturedUri = result.assets[0].uri;
        setImageUris((current) =>
          current.includes(capturedUri)
            ? current
            : [...current, capturedUri].slice(
                0,
                RECIPE_IMPORT_LIMITS.sourceImages,
              ),
        );
      }
    } catch (error) {
      console.error("Failed to take recipe import photo:", error);
      Alert.alert("Camera Error", "Unable to open your camera.");
    }
  };

  const handleRemoveImage = (uri: string) => {
    setImageUris((current) => current.filter((imageUri) => imageUri !== uri));
    importAttemptRef.current = null;
  };

  const handleImport = async () => {
    setIsStarting(true);

    try {
      if (mode === "url") {
        const submittedUrl = url.trim();
        if (!submittedUrl) {
          Alert.alert("Error", "Please enter a URL");
          return;
        }

        if (submittedUrl.length > RECIPE_IMPORT_LIMITS.urlCharacters) {
          Alert.alert(
            "URL too long",
            "Recipe URLs must be 4,096 characters or less.",
          );
          return;
        }
        const attempt = getImportAttempt(`url:${submittedUrl}`);
        await submitImport({
          id: attempt.id,
          importType: "smart",
          source: { type: "url", value: submittedUrl },
        });
        importAttemptRef.current = null;
        handleClose();
        return;
      }

      if (mode === "text") {
        const submittedText = text.trim();
        if (!submittedText || submittedText.length < 50) {
          Alert.alert(
            "Error",
            "Please enter at least 50 characters of recipe text",
          );
          return;
        }
        if (submittedText.length > RECIPE_IMPORT_LIMITS.textCharacters) {
          Alert.alert(
            "Text too long",
            "Recipe text must be 10,000 characters or less.",
          );
          return;
        }

        const attempt = getImportAttempt(`text:${submittedText}`);
        await submitImport({
          id: attempt.id,
          importType: "smart",
          source: { type: "text", value: submittedText },
        });
        importAttemptRef.current = null;
        handleClose();
        return;
      }

      if (mode === "image") {
        const submittedImageUris = imageUris;
        if (submittedImageUris.length === 0) {
          Alert.alert("Error", "Please select at least one image");
          return;
        }

        const attempt = getImportAttempt(
          `images:${JSON.stringify(submittedImageUris)}`,
        );
        const maxBytesPerImage = recipeImportSourceImageByteBudget(
          submittedImageUris.length,
        );
        const uploadKeys = await Promise.all(
          submittedImageUris.map(async (uri) => {
            const existingUpload = attempt.uploadsByUri.get(uri);
            if (existingUpload) return await existingUpload;

            const upload = uploadImportSource(uri, maxBytesPerImage).catch(
              (error) => {
                attempt.uploadsByUri.delete(uri);
                throw error;
              },
            );
            attempt.uploadsByUri.set(uri, upload);
            return await upload;
          }),
        );
        await submitImport({
          id: attempt.id,
          importType: "smart",
          source: { type: "image", uploadKeys },
        });
        importAttemptRef.current = null;
        handleClose();
      }
    } catch (error) {
      console.error("Failed to start smart import:", error);
      Alert.alert("Import Error", "Unable to start this import.");
    } finally {
      setIsStarting(false);
    }
  };

  const getButtonLabel = () => {
    if (isStarting) return "Starting...";
    switch (mode) {
      case "url":
        return "Import from URL";
      case "text":
        return "Import from Text";
      case "image":
        return imageUris.length > 1
          ? `Import from ${imageUris.length} Images`
          : "Import from Image";
    }
  };

  return (
    <AppSheet
      ref={sheetRef}
      title="Smart Import"
      detents={["auto"]}
      dismissible={!isStarting}
      backgroundColor={theme.colors.background}
      closeDisabled={isStarting}
      onDidDismiss={handleDidDismiss}
    >
      <ScrollView keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
          {/* Mode Selector */}
          <View style={styles.modeSelector}>
            <ModeOption
              icon="link-outline"
              label="URL"
              selected={mode === "url"}
              onPress={() => setMode("url")}
            />
            <ModeOption
              icon="document-text-outline"
              label="Text"
              selected={mode === "text"}
              onPress={() => setMode("text")}
            />
            <ModeOption
              icon="image-outline"
              label="Image"
              selected={mode === "image"}
              onPress={() => setMode("image")}
            />
          </View>

          <VSpace size={24} />

          {mode === "url" && (
            <Animated.View entering={FadeIn.duration(200)}>
              <Text type="subheadline" style={styles.label}>
                Recipe URL
              </Text>
              <VSpace size={8} />
              <Input
                placeholder="https://example.com/recipe"
                value={url}
                onChangeText={setUrl}
                keyboardType="url"
                returnKeyType="go"
                onSubmitEditing={handleImport}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isStarting}
              />
              <VSpace size={8} />
              <Text type="caption" style={styles.hint}>
                Works with most recipe websites and social media links
              </Text>
            </Animated.View>
          )}

          {mode === "text" && (
            <Animated.View entering={FadeIn.duration(200)}>
              <Text type="subheadline" style={styles.label}>
                Recipe Text
              </Text>
              <VSpace size={8} />
              <TextInput
                style={styles.textArea}
                placeholder="Paste ingredients, instructions, or a full recipe..."
                placeholderTextColor={styles.placeholder.color}
                value={text}
                onChangeText={setText}
                multiline
                numberOfLines={10}
                textAlignVertical="top"
                editable={!isStarting}
              />
              <VSpace size={8} />
              <Text type="caption" style={styles.hint}>
                {text.length} characters (minimum 50)
              </Text>
            </Animated.View>
          )}

          {mode === "image" && (
            <Animated.View entering={FadeIn.duration(200)}>
              <View style={styles.imageLabelRow}>
                <Text type="subheadline" style={styles.label}>
                  Recipe Images
                </Text>
                <Text type="caption" style={styles.imageCount}>
                  {imageUris.length} of {RECIPE_IMPORT_LIMITS.sourceImages}
                </Text>
              </View>
              <VSpace size={8} />
              {imageUris.length > 0 && (
                <ScrollView
                  horizontal
                  style={styles.imagePreviewScroll}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.imagePreviewList}
                >
                  {imageUris.map((uri, index) => (
                    <View key={uri} style={styles.imagePreviewContainer}>
                      <Image
                        source={{ uri }}
                        style={styles.imagePreview}
                        contentFit="cover"
                      />
                      <View style={styles.imageNumberBadge}>
                        <Text type="caption" style={styles.imageNumberText}>
                          {index + 1}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={styles.removeImageButton}
                        onPress={() => handleRemoveImage(uri)}
                        disabled={isStarting}
                        accessibilityLabel={`Remove image ${index + 1}`}
                      >
                        <Ionicons name="close" size={18} color="white" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              )}
              {imageUris.length > 0 &&
                imageUris.length < RECIPE_IMPORT_LIMITS.sourceImages && (
                  <VSpace size={12} />
                )}
              {imageUris.length < RECIPE_IMPORT_LIMITS.sourceImages && (
                <View style={styles.imagePickerOptions}>
                  <TouchableOpacity
                    style={[
                      styles.imagePickerOption,
                      imageUris.length > 0 && styles.imagePickerOptionCompact,
                    ]}
                    onPress={handleTakePhoto}
                    disabled={isStarting}
                  >
                    <Ionicons
                      name="camera-outline"
                      size={28}
                      style={styles.imagePickerIcon}
                    />
                    <VSpace size={6} />
                    <Text type="subheadline" style={styles.imagePickerText}>
                      {imageUris.length > 0 ? "Take Another" : "Take Photo"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.imagePickerOption,
                      imageUris.length > 0 && styles.imagePickerOptionCompact,
                    ]}
                    onPress={handlePickImages}
                    disabled={isStarting}
                  >
                    <Ionicons
                      name="images-outline"
                      size={28}
                      style={styles.imagePickerIcon}
                    />
                    <VSpace size={6} />
                    <Text type="subheadline" style={styles.imagePickerText}>
                      Choose Photos
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
              <VSpace size={8} />
              <Text type="caption" style={styles.hint}>
                Add up to {RECIPE_IMPORT_LIMITS.sourceImages} full images in
                page order from a recipe card, cookbook, or screenshots
              </Text>
            </Animated.View>
          )}

          <Animated.View layout={LinearTransition.duration(200)}>
            <VSpace size={24} />

            <PrimaryButton onPress={handleImport} disabled={isStarting}>
              {getButtonLabel()}
            </PrimaryButton>
          </Animated.View>
        </View>
      </ScrollView>
    </AppSheet>
  );
});

const styles = StyleSheet.create((theme, runtime) => {
  const isDarkTheme = isDarkThemeRuntime(runtime);
  const imagePickerTextColor = isDarkTheme
    ? theme.colors.text
    : theme.colors.textSecondary;
  const imagePickerIconColor = isDarkTheme
    ? theme.colors.text
    : theme.colors.textTertiary;

  return {
    content: {
      paddingHorizontal: 20,
    },
    modeSelector: {
      flexDirection: "row",
      gap: 12,
    },
    label: {
      color: theme.colors.text,
      marginLeft: 4,
    },
    hint: {
      color: theme.colors.textSecondary,
      marginLeft: 4,
    },
    imageLabelRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    imageCount: {
      color: theme.colors.textSecondary,
      marginRight: 4,
    },
    textArea: {
      width: "100%",
      height: 180,
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderRadius: theme.borderRadius.large,
      backgroundColor: theme.colors.inputBackground,
      fontFamily: theme.fonts.regular,
      fontSize: 16,
      color: theme.colors.text,
    },
    placeholder: {
      color: theme.colors.placeholderText,
    },
    imagePickerOptions: {
      flexDirection: "row",
      gap: 12,
    },
    imagePickerOption: {
      flex: 1,
      height: 120,
      borderRadius: theme.borderRadius.large,
      backgroundColor: theme.colors.inputBackground,
      alignItems: "center",
      justifyContent: "center",
    },
    imagePickerOptionCompact: {
      height: 84,
    },
    imagePickerIcon: {
      color: imagePickerIconColor,
    },
    imagePickerText: {
      color: imagePickerTextColor,
    },
    imagePreviewScroll: {
      marginHorizontal: -20,
    },
    imagePreviewList: {
      gap: 12,
      paddingHorizontal: 20,
    },
    imagePreviewContainer: {
      position: "relative",
      width: 180,
      height: 180,
      borderRadius: theme.borderRadius.large,
      overflow: "hidden",
      backgroundColor: theme.colors.inputBackground,
    },
    imagePreview: {
      width: "100%",
      height: "100%",
    },
    imageNumberBadge: {
      position: "absolute",
      left: 8,
      top: 8,
      width: 26,
      height: 26,
      borderRadius: theme.borderRadius.full,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(0,0,0,0.65)",
    },
    imageNumberText: {
      color: "white",
      fontWeight: "600",
    },
    removeImageButton: {
      position: "absolute",
      right: 8,
      top: 8,
      backgroundColor: "rgba(0,0,0,0.65)",
      width: 30,
      height: 30,
      borderRadius: theme.borderRadius.full,
      alignItems: "center",
      justifyContent: "center",
    },
  };
});
