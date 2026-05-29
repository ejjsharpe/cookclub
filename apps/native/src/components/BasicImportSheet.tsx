import { TrueSheet } from "@lodev09/react-native-true-sheet";
import { forwardRef, useState, useImperativeHandle, useRef } from "react";
import { View, Alert, ScrollView } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { AppSheet } from "./AppSheet";
import { Input } from "./Input";
import { VSpace } from "./Space";
import { Text } from "./Text";
import { PrimaryButton } from "./buttons/PrimaryButton";

import {
  createBackgroundImportId,
  type BackgroundImportTask,
} from "@/lib/backgroundImportQueue";
import { isBasicImportUnsupportedUrl } from "@/utils/basicImport";
import { getRecipeImportSourceTitle } from "@/utils/socialPlatforms";

export interface BasicImportSheetProps {
  onImportStarted?: (task: BackgroundImportTask) => void;
}

export interface BasicImportSheetRef {
  present: () => void;
  dismiss: () => void;
}

export const BasicImportSheet = forwardRef<
  BasicImportSheetRef,
  BasicImportSheetProps
>(({ onImportStarted }, ref) => {
  const sheetRef = useRef<TrueSheet>(null);
  const [url, setUrl] = useState("");
  const [isStarting, setIsStarting] = useState(false);

  useImperativeHandle(ref, () => ({
    present: () => sheetRef.current?.present(),
    dismiss: () => sheetRef.current?.dismiss(),
  }));

  const handleClose = () => {
    sheetRef.current?.dismiss();
  };

  const handleDidDismiss = () => {
    setUrl("");
    setIsStarting(false);
  };

  const handleImport = () => {
    const submittedUrl = url.trim();

    if (!submittedUrl) {
      Alert.alert("Error", "Please enter a URL");
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
      onImportStarted?.({
        id: createBackgroundImportId("url"),
        importType: "basic",
        mode: "url",
        title: getRecipeImportSourceTitle(submittedUrl),
        data: submittedUrl,
      });
      handleClose();
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
