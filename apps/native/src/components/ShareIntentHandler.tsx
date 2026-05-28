import { useNavigation } from "@react-navigation/native";
import { useShareIntentContext } from "expo-share-intent";
import { useCallback, useEffect, useRef } from "react";
import { Alert } from "react-native";

import { isAdaptyConfigured } from "@/lib/adapty";
import {
  createBackgroundImportId,
  useBackgroundImportQueue,
} from "@/lib/backgroundImportQueue";
import {
  getPendingShareIntent,
  clearPendingShareIntent,
  setPendingShareIntent,
  type PendingShareIntent,
} from "@/lib/pendingShareIntent";
import { useSubscription } from "@/lib/subscription";
import { isBasicImportUnsupportedUrl } from "@/utils/basicImport";
import { imageToBase64 } from "@/utils/imageUtils";

const supportedImageMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const getSupportedImageMimeType = (mimeType?: string) => {
  if (mimeType && supportedImageMimeTypes.has(mimeType)) {
    return mimeType as "image/jpeg" | "image/png" | "image/webp";
  }
  return "image/jpeg";
};

export function ShareIntentHandler() {
  const { hasShareIntent, shareIntent, resetShareIntent } =
    useShareIntentContext();
  const navigation = useNavigation();
  const hasProcessedRef = useRef(false);
  const hasCheckedPendingRef = useRef(false);

  const { startImport } = useBackgroundImportQueue();
  const { status, isPro, smartImportsRemaining, presentPaywall, refresh } =
    useSubscription();

  const navigateToAddRecipeTab = useCallback(() => {
    navigation.navigate("Tabs", { screen: "Add recipe" } as never);
  }, [navigation]);

  const canUseSmartImportForShare = useCallback(async () => {
    if (isPro) return true;
    if (status) return (status.smartImports.remaining ?? 0) > 0;

    try {
      const refreshedStatus = await refresh();
      if (refreshedStatus?.isPro) return true;
      return (refreshedStatus?.smartImports.remaining ?? 0) > 0;
    } catch (error) {
      console.warn("Failed to refresh subscription before share import", error);
      return status ? (smartImportsRemaining ?? 0) > 0 : false;
    }
  }, [isPro, refresh, smartImportsRemaining, status]);

  const startSmartImport = useCallback(
    async (intent: PendingShareIntent) => {
      const id = createBackgroundImportId(intent.type);
      const imageData =
        intent.type === "image" && !intent.isBase64
          ? await imageToBase64(intent.content)
          : null;

      startImport({
        id,
        importType: "smart",
        mode: intent.type,
        title:
          intent.type === "url"
            ? intent.content
            : intent.type === "text"
              ? "Shared recipe text"
              : "Shared recipe image",
        data: imageData?.base64 ?? intent.content,
        mimeType:
          imageData?.mimeType ??
          (intent.type === "image"
            ? getSupportedImageMimeType(intent.mimeType)
            : undefined),
      });
    },
    [startImport],
  );

  const prepareIntentForPending = useCallback(
    async (intent: PendingShareIntent): Promise<PendingShareIntent> => {
      if (intent.type !== "image" || intent.isBase64) return intent;

      const { base64, mimeType } = await imageToBase64(intent.content);
      return {
        ...intent,
        content: base64,
        mimeType,
        isBase64: true,
      };
    },
    [],
  );

  const startBasicUrlImport = useCallback(
    (intent: PendingShareIntent) => {
      startImport({
        id: createBackgroundImportId("url"),
        importType: "basic",
        mode: "url",
        title: intent.content,
        data: intent.content,
      });
    },
    [startImport],
  );

  // Process a share intent (either new or pending)
  const processShareIntent = useCallback(
    async (intent: PendingShareIntent) => {
      const canUseSmartImport = await canUseSmartImportForShare();
      if (canUseSmartImport) {
        await startSmartImport(intent);
        clearPendingShareIntent();
        resetShareIntent();
        navigateToAddRecipeTab();
        return;
      }

      if (
        intent.type === "url" &&
        !isBasicImportUnsupportedUrl(intent.content)
      ) {
        startBasicUrlImport(intent);
        clearPendingShareIntent();
        resetShareIntent();
        navigateToAddRecipeTab();
        return;
      }

      const upgraded = await presentPaywall();
      if (!upgraded) {
        setPendingShareIntent(await prepareIntentForPending(intent));
        resetShareIntent();
        navigateToAddRecipeTab();
        return;
      }

      await startSmartImport(intent);
      clearPendingShareIntent();
      resetShareIntent();
      navigateToAddRecipeTab();
    },
    [
      canUseSmartImportForShare,
      navigateToAddRecipeTab,
      presentPaywall,
      prepareIntentForPending,
      resetShareIntent,
      startBasicUrlImport,
      startSmartImport,
    ],
  );

  // Detect content type from share intent
  const detectContentType = (
    intent: typeof shareIntent,
  ): PendingShareIntent | null => {
    // Check for URL first
    if (intent?.webUrl) {
      return { type: "url", content: intent.webUrl, timestamp: Date.now() };
    }

    // Check for image files
    if (intent?.files && intent.files.length > 0) {
      const file = intent.files[0];
      if (file?.mimeType?.startsWith("image/")) {
        return {
          type: "image",
          content: file.path,
          mimeType: file.mimeType,
          timestamp: Date.now(),
        };
      }
    }

    // Check for text content
    if (intent?.text) {
      // Check if the text contains a URL
      const urlMatch = intent.text.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/i);
      if (urlMatch) {
        return { type: "url", content: urlMatch[0], timestamp: Date.now() };
      }

      // Otherwise treat as recipe text
      if (intent.text.length >= 50) {
        return { type: "text", content: intent.text, timestamp: Date.now() };
      }
    }

    return null;
  };

  // Check for pending share intent on mount (from previous session or pre-login)
  useEffect(() => {
    if (!isAdaptyConfigured()) {
      clearPendingShareIntent();
      return;
    }

    if (hasCheckedPendingRef.current) return;
    hasCheckedPendingRef.current = true;

    const pendingIntent = getPendingShareIntent();
    if (pendingIntent) {
      // Small delay to ensure navigation is ready
      setTimeout(() => {
        processShareIntent(pendingIntent).catch((error) => {
          console.error("Error processing pending share intent:", error);
          Alert.alert("Error", "Failed to process the pending recipe.");
          clearPendingShareIntent();
        });
      }, 500);
    }
  }, [processShareIntent]);

  // Handle new share intents
  useEffect(() => {
    if (!hasShareIntent || !shareIntent || hasProcessedRef.current) return;

    if (!isAdaptyConfigured()) {
      resetShareIntent();
      return;
    }

    const detectedIntent = detectContentType(shareIntent);
    if (!detectedIntent) {
      resetShareIntent();
      return;
    }

    hasProcessedRef.current = true;

    processShareIntent(detectedIntent).catch((error) => {
      console.error("Error processing share intent:", error);
      Alert.alert("Error", "Failed to process the shared recipe.");
      resetShareIntent();
    });
  }, [hasShareIntent, processShareIntent, resetShareIntent, shareIntent]);

  // Reset the processed flag when share intent is cleared
  useEffect(() => {
    if (!hasShareIntent) {
      hasProcessedRef.current = false;
    }
  }, [hasShareIntent]);

  return null;
}
