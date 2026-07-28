import { TrueSheet } from "@lodev09/react-native-true-sheet";
import {
  RECIPE_IMPORT_LIMITS,
  isBasicImportUnsupportedUrl,
} from "@repo/contracts/recipe-import";
import { forwardRef, useState, useImperativeHandle, useRef } from "react";
import { View, Alert, ScrollView } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { createRecipeImportId, useRecipeImport } from "./RecipeImportProvider";

import { AppSheet } from "@/components/AppSheet";
import { Input } from "@/components/Input";
import { VSpace } from "@/components/Space";
import { Text } from "@/components/Text";
import { PrimaryButton } from "@/components/buttons/PrimaryButton";

export interface BasicImportSheetRef {
  present: () => void;
  dismiss: () => void;
}

export const BasicImportSheet = forwardRef<BasicImportSheetRef>((_, ref) => {
  const sheetRef = useRef<TrueSheet>(null);
  const { submitImport } = useRecipeImport();
  const [url, setUrl] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const importAttemptRef = useRef<{ id: string; url: string } | null>(null);

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
    setIsStarting(false);
  };

  const handleImport = async () => {
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

    // Check for unsupported social media URLs before making API call
    if (isBasicImportUnsupportedUrl(submittedUrl)) {
      Alert.alert(
        "Unsupported Link",
        "Social media links aren't supported with Basic Import. They don't contain structured recipe data.",
      );
      return;
    }

    setIsStarting(true);
    try {
      const attempt =
        importAttemptRef.current?.url === submittedUrl
          ? importAttemptRef.current
          : { id: createRecipeImportId(), url: submittedUrl };
      importAttemptRef.current = attempt;
      await submitImport({
        id: attempt.id,
        importType: "basic",
        source: { type: "url", value: submittedUrl },
      });
      importAttemptRef.current = null;
      handleClose();
    } catch {
      Alert.alert(
        "Import Error",
        "Unable to start this import. Please try again.",
      );
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <AppSheet
      ref={sheetRef}
      title="Basic Import"
      detents={["auto"]}
      dismissible={!isStarting}
      closeDisabled={isStarting}
      onDidDismiss={handleDidDismiss}
    >
      <ScrollView keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
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
            Works with most recipe websites that use standard recipe markup
          </Text>

          <VSpace size={24} />

          <PrimaryButton onPress={handleImport} disabled={isStarting}>
            {isStarting ? "Starting..." : "Import Recipe"}
          </PrimaryButton>
        </View>
      </ScrollView>
    </AppSheet>
  );
});

const styles = StyleSheet.create((theme) => ({
  content: {
    paddingHorizontal: 20,
  },
  label: {
    color: theme.colors.text,
    marginLeft: 4,
  },
  hint: {
    color: theme.colors.textSecondary,
    marginLeft: 4,
  },
}));
