import {
  RECIPE_IMPORT_LIMITS,
  recipeImportSourceImageByteBudget,
  type RecipeImportType,
} from "@repo/contracts/recipe-import";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useMemo, useRef, useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Pressable,
  ScrollView,
  TextInput,
  type TextInputInstance,
  View,
} from "react-native";
import Animated, { FadeIn, LinearTransition } from "react-native-reanimated";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { ImportMethodMenu } from "./ImportMethodMenu";
import { createRecipeImportId, useRecipeImport } from "./RecipeImportProvider";

import { Ionicons } from "@/components/Ionicons";
import { Text } from "@/components/Text";
import { alertApiError } from "@/lib/apiErrorAlert";
import {
  defaultImportType,
  detectImportSource,
  importSourceProblem,
  type DetectedImportSource,
} from "@/lib/recipeImportSource";
import { useSubscription } from "@/lib/subscription";
import {
  ensureCameraPermission,
  ensureMediaLibraryPermission,
} from "@/utils/imagePickerPermissions";
import { getRecipeImportSocialPlatformInfo } from "@/utils/socialPlatforms";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

type ImportAttempt = {
  id: string;
  key: string;
  uploadsByUri: Map<string, Promise<string>>;
};

const Chip = ({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: IoniconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    accessibilityRole="button"
    accessibilityState={{ disabled: !!disabled }}
    style={({ pressed }) => [
      styles.chip,
      pressed && styles.pressed,
      disabled && styles.disabled,
    ]}
  >
    <Ionicons name={icon} size={16} style={styles.chipIcon} />
    <Text type="subheadline" style={styles.chipLabel}>
      {label}
    </Text>
  </Pressable>
);

/** The card under a pasted link saying where it's from and how it'll import. */
const SourceCard = ({
  source,
  importType,
  canChoose,
  smartSubtitle,
  disabled,
  onChoose,
}: {
  source: Extract<DetectedImportSource, { kind: "url" }>;
  importType: RecipeImportType;
  canChoose: boolean;
  smartSubtitle: string;
  disabled: boolean;
  onChoose: (type: RecipeImportType) => void;
}) => {
  const { theme } = useUnistyles();
  const social = source.social
    ? getRecipeImportSocialPlatformInfo(source.social)
    : null;
  const isSmart = importType === "smart";
  const subtitle = !isSmart
    ? "Reads the recipe from the page"
    : social
      ? "AI writes up the recipe for you"
      : "AI reads the whole page for you";

  return (
    <Animated.View entering={FadeIn.duration(160)} style={styles.sourceCard}>
      <View
        style={[
          styles.sourceIcon,
          social && { backgroundColor: `${social.color}1A` },
        ]}
      >
        <Ionicons
          name={social?.icon ?? "globe-outline"}
          size={18}
          color={social?.color ?? theme.colors.text}
        />
      </View>
      <View style={styles.sourceText}>
        <Text type="subheadline" style={styles.sourceTitle} numberOfLines={1}>
          {social ? `${social.displayName} post` : source.site}
        </Text>
        <Text type="caption" style={styles.secondary} numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
      {canChoose ? (
        <ImportMethodMenu
          importType={importType}
          smartSubtitle={smartSubtitle}
          disabled={disabled}
          onChoose={onChoose}
        >
          <View
            style={styles.methodPill}
            accessible
            accessibilityRole="button"
            accessibilityLabel={`${isSmart ? "Smart" : "Quick"} import`}
            accessibilityHint="Choose how to import"
          >
            {isSmart && (
              <Ionicons name="sparkles" size={12} style={styles.methodSmart} />
            )}
            <Text
              type="caption"
              style={[styles.methodLabel, isSmart && styles.methodSmart]}
            >
              {isSmart ? "Smart" : "Quick"}
            </Text>
            <Ionicons
              name="chevron-expand"
              size={13}
              style={styles.methodChevron}
            />
          </View>
        </ImportMethodMenu>
      ) : (
        <View style={[styles.methodPill, styles.methodPillSmart]}>
          <Ionicons name="sparkles" size={12} style={styles.methodSmart} />
          <Text type="caption" style={[styles.methodLabel, styles.methodSmart]}>
            Smart
          </Text>
        </View>
      )}
    </Animated.View>
  );
};

/**
 * One box for every kind of import. Paste a link or a recipe, or add photos,
 * and it picks quick import (free) or smart import (AI) for you. Recipe site
 * links can be switched to smart import from the card under the link.
 */
export const RecipeImportBox = () => {
  const { theme } = useUnistyles();
  const { submitImport, uploadImportSource } = useRecipeImport();
  const {
    isPro,
    smartImportsRemaining,
    smartImportsLimit,
    requireSmartImport,
  } = useSubscription();
  const [value, setValue] = useState("");
  const [imageUris, setImageUris] = useState<string[]>([]);
  // A choice of quick or smart belongs to the site it was made for, so it
  // survives fixing a typo in the link but not pasting a different site
  const [chosen, setChosen] = useState<{
    site: string;
    type: RecipeImportType;
  } | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const isStartingRef = useRef(false);
  const attemptRef = useRef<ImportAttempt | null>(null);
  const inputRef = useRef<TextInputInstance>(null);

  const source = useMemo(() => detectImportSource(value), [value]);
  const hasImages = imageUris.length > 0;
  const canChoose =
    !hasImages && source.kind === "url" && source.canQuickImport;
  const chosenType =
    source.kind === "url" && chosen?.site === source.site ? chosen.type : null;
  const importType =
    canChoose && chosenType
      ? chosenType
      : defaultImportType(source, imageUris.length);
  const problem = importSourceProblem(source, imageUris.length);
  const canSubmit = !problem && !isStarting;
  const isEmpty = source.kind === "empty" && !hasImages;

  const smartAllowance =
    smartImportsRemaining === null || smartImportsLimit === null
      ? null
      : `${smartImportsRemaining} of ${smartImportsLimit} left`;
  // Only say something when there's a problem to fix
  const warning =
    problem && source.kind !== "empty"
      ? problem
      : importType === "smart" && !isPro && smartImportsRemaining === 0
        ? "You've used all your smart imports. Go Pro for unlimited."
        : null;

  const reset = () => {
    setValue("");
    setImageUris([]);
    setChosen(null);
    attemptRef.current = null;
  };

  const handleChooseType = (type: RecipeImportType) => {
    if (source.kind === "url") setChosen({ site: source.site, type });
  };

  const addImages = (uris: string[]) => {
    setValue("");
    setChosen(null);
    setImageUris((current) =>
      Array.from(new Set([...current, ...uris])).slice(
        0,
        RECIPE_IMPORT_LIMITS.sourceImages,
      ),
    );
  };

  const handlePickImages = async () => {
    const slots = RECIPE_IMPORT_LIMITS.sourceImages - imageUris.length;
    if (slots <= 0) return;
    const allowed = await ensureMediaLibraryPermission({
      message: "Allow access to your photos to import a recipe from them.",
    });
    if (!allowed) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        orderedSelection: true,
        selectionLimit: slots,
        quality: 0.8,
      });
      if (!result.canceled) addImages(result.assets.map((a) => a.uri));
    } catch (error) {
      console.error("Failed to pick recipe import images:", error);
      Alert.alert("Couldn't open your photos", "Please try again.");
    }
  };

  const handleTakePhoto = async () => {
    if (imageUris.length >= RECIPE_IMPORT_LIMITS.sourceImages) return;
    const allowed = await ensureCameraPermission();
    if (!allowed) return;
    try {
      const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
      const uri = result.canceled ? undefined : result.assets[0]?.uri;
      if (uri) addImages([uri]);
    } catch (error) {
      console.error("Failed to take recipe import photo:", error);
      Alert.alert("Couldn't open the camera", "Please try again.");
    }
  };

  const handleRemoveImage = (uri: string) => {
    setImageUris((current) => current.filter((u) => u !== uri));
    attemptRef.current = null;
  };

  // Retrying the same import reuses its id and any finished uploads
  const attemptFor = (key: string) => {
    if (attemptRef.current?.key !== key) {
      attemptRef.current = {
        id: createRecipeImportId(),
        key,
        uploadsByUri: new Map(),
      };
    }
    return attemptRef.current;
  };

  const handleImport = async () => {
    // A ref, not state, so a quick double tap can't start two imports
    if (!canSubmit || isStartingRef.current) return;
    isStartingRef.current = true;
    setIsStarting(true);
    Keyboard.dismiss();
    try {
      if (importType === "smart" && !(await requireSmartImport())) return;
      if (hasImages) {
        const attempt = attemptFor(`images:${JSON.stringify(imageUris)}`);
        const maxBytes = recipeImportSourceImageByteBudget(imageUris.length);
        const uploadKeys = await Promise.all(
          imageUris.map((uri) => {
            const existing = attempt.uploadsByUri.get(uri);
            if (existing) return existing;
            const upload = uploadImportSource(uri, maxBytes).catch((error) => {
              attempt.uploadsByUri.delete(uri);
              throw error;
            });
            attempt.uploadsByUri.set(uri, upload);
            return upload;
          }),
        );
        await submitImport({
          id: attempt.id,
          importType: "smart",
          source: { type: "image", uploadKeys },
        });
      } else if (source.kind === "url") {
        const attempt = attemptFor(`${importType}:url:${source.url}`);
        await submitImport({
          id: attempt.id,
          importType,
          source: { type: "url", value: source.url },
        });
      } else if (source.kind === "text") {
        const attempt = attemptFor(`text:${source.text}`);
        await submitImport({
          id: attempt.id,
          importType: "smart",
          source: { type: "text", value: source.text },
        });
      }
      reset();
    } catch (error) {
      alertApiError("Couldn't start the import", error, {
        operation: "recipeImport.create",
        fallback: "Something went wrong. Please try again.",
      });
    } finally {
      isStartingRef.current = false;
      setIsStarting(false);
    }
  };

  return (
    <Animated.View layout={LinearTransition.duration(180)}>
      <Pressable
        style={styles.box}
        onPress={() => inputRef.current?.focus()}
        accessible={false}
      >
        {hasImages ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.images}
          >
            {imageUris.map((uri, index) => (
              <View key={uri}>
                <Image
                  source={{ uri }}
                  style={styles.image}
                  contentFit="cover"
                  accessibilityLabel={`Photo ${index + 1}`}
                />
                <View style={styles.imageNumber} pointerEvents="none">
                  <Text type="caption" style={styles.imageNumberText}>
                    {index + 1}
                  </Text>
                </View>
                <Pressable
                  onPress={() => handleRemoveImage(uri)}
                  disabled={isStarting}
                  hitSlop={8}
                  style={styles.imageRemove}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove photo ${index + 1}`}
                >
                  <Ionicons name="close" size={13} color="#fff" />
                </Pressable>
              </View>
            ))}
            {imageUris.length < RECIPE_IMPORT_LIMITS.sourceImages && (
              <>
                <Pressable
                  onPress={handleTakePhoto}
                  disabled={isStarting}
                  style={[styles.image, styles.imageAdd]}
                  accessibilityRole="button"
                  accessibilityLabel="Take another photo"
                >
                  <Ionicons
                    name="camera-outline"
                    size={24}
                    style={styles.imageAddIcon}
                  />
                </Pressable>
                <Pressable
                  onPress={handlePickImages}
                  disabled={isStarting}
                  style={[styles.image, styles.imageAdd]}
                  accessibilityRole="button"
                  accessibilityLabel="Add photos from your library"
                >
                  <Ionicons
                    name="images-outline"
                    size={24}
                    style={styles.imageAddIcon}
                  />
                </Pressable>
              </>
            )}
          </ScrollView>
        ) : (
          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={setValue}
            placeholder="Paste a link or a recipe"
            placeholderTextColor={theme.colors.textSecondary}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isStarting}
            style={styles.input(isEmpty)}
            accessibilityLabel="Recipe link or text"
          />
        )}

        {source.kind === "url" && !hasImages && (
          <SourceCard
            source={source}
            importType={importType}
            canChoose={canChoose}
            disabled={isStarting}
            smartSubtitle={
              isPro || !smartAllowance
                ? "Uses AI, for pages quick import gets wrong"
                : `Uses AI · ${smartAllowance}`
            }
            onChoose={handleChooseType}
          />
        )}

        <View style={styles.footer}>
          {isEmpty ? (
            <>
              <Chip
                icon="images-outline"
                label="Photos"
                onPress={handlePickImages}
              />
              <Chip
                icon="camera-outline"
                label="Camera"
                onPress={handleTakePhoto}
              />
            </>
          ) : (
            <>
              <Chip
                icon="close"
                label="Clear"
                onPress={reset}
                disabled={isStarting}
              />
              {hasImages && (
                <Text type="caption" style={styles.secondary}>
                  {imageUris.length} of {RECIPE_IMPORT_LIMITS.sourceImages}{" "}
                  photos
                </Text>
              )}
            </>
          )}
          <View style={styles.spacer} />
          <Pressable
            onPress={handleImport}
            disabled={!canSubmit}
            hitSlop={6}
            style={[styles.send, !canSubmit && !isStarting && styles.sendOff]}
            accessibilityRole="button"
            accessibilityLabel={
              importType === "smart" ? "Import with smart import" : "Import"
            }
            accessibilityHint={warning ?? undefined}
            accessibilityState={{ disabled: !canSubmit, busy: isStarting }}
          >
            {isStarting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="arrow-up" size={20} color="#fff" />
            )}
          </Pressable>
        </View>
      </Pressable>
      {warning && (
        <Text
          type="caption"
          style={styles.hint}
          accessibilityLiveRegion="polite"
        >
          {warning}
        </Text>
      )}
    </Animated.View>
  );
};

const styles = StyleSheet.create((theme) => ({
  box: {
    marginHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    paddingLeft: 16,
    paddingRight: 12,
    gap: 12,
    borderRadius: 26,
    backgroundColor: theme.colors.inputBackground,
  },
  input: (isEmpty: boolean) => ({
    minHeight: isEmpty ? 64 : 0,
    maxHeight: 160,
    padding: 0,
    fontSize: 17,
    lineHeight: 23,
    fontFamily: theme.fonts.medium,
    color: theme.colors.text,
    textAlignVertical: "top" as const,
  }),
  images: {
    gap: 8,
    paddingRight: 4,
  },
  image: {
    width: 72,
    height: 72,
    borderRadius: 14,
  },
  imageNumber: {
    position: "absolute",
    left: 4,
    bottom: 4,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  imageNumberText: {
    color: "#fff",
    fontFamily: theme.fonts.bold,
  },
  imageRemove: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  imageAdd: {
    backgroundColor: theme.colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  imageAddIcon: {
    color: theme.colors.textSecondary,
  },
  sourceCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 16,
    backgroundColor: theme.colors.background,
  },
  sourceIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: theme.colors.inputBackground,
    alignItems: "center",
    justifyContent: "center",
  },
  sourceText: {
    flex: 1,
    gap: 1,
  },
  sourceTitle: {
    fontFamily: theme.fonts.bold,
    color: theme.colors.text,
  },
  secondary: {
    color: theme.colors.textSecondary,
  },
  methodPill: {
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: theme.colors.inputBackground,
  },
  methodPillSmart: {
    backgroundColor: theme.colors.primarySoft,
  },
  methodLabel: {
    fontFamily: theme.fonts.bold,
    color: theme.colors.text,
  },
  methodSmart: {
    color: theme.colors.primary,
  },
  methodChevron: {
    color: theme.colors.textSecondary,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  spacer: {
    flex: 1,
  },
  chip: {
    height: 36,
    paddingLeft: 11,
    paddingRight: 13,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: theme.colors.background,
  },
  chipIcon: {
    color: theme.colors.text,
  },
  chipLabel: {
    fontFamily: theme.fonts.bold,
    color: theme.colors.text,
  },
  pressed: {
    opacity: 0.6,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundImage: theme.colors.primaryGradient,
    alignItems: "center",
    justifyContent: "center",
  },
  sendOff: {
    backgroundImage: "none",
    backgroundColor: theme.colors.placeholderText,
  },
  disabled: {
    opacity: 0.5,
  },
  hint: {
    marginTop: 10,
    marginHorizontal: 22,
    color: theme.colors.textSecondary,
  },
}));
