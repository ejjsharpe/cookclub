import { useNavigation } from "@react-navigation/native";
import { useShareIntentContext } from "expo-share-intent";
import { useCallback, useEffect, useRef } from "react";
import { Alert } from "react-native";

import {
  useParseRecipeFromUrl,
  useParseRecipeFromUrlBasic,
  useParseRecipeFromText,
  useParseRecipeFromImage,
} from "@/api/recipe";
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

export function ShareIntentHandler() {
  const { hasShareIntent, shareIntent, resetShareIntent } =
    useShareIntentContext();
  const navigation = useNavigation();
  const hasProcessedRef = useRef(false);
  const hasCheckedPendingRef = useRef(false);

  const parseFromUrl = useParseRecipeFromUrl();
  const parseFromUrlBasic = useParseRecipeFromUrlBasic();
  const parseFromText = useParseRecipeFromText();
  const parseFromImage = useParseRecipeFromImage();
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
    (intent: PendingShareIntent) => {
      const id = createBackgroundImportId(intent.type);
      const mimeType = (intent.mimeType || "image/jpeg") as
        | "image/jpeg"
        | "image/png"
        | "image/webp";

      startImport({
        id,
        mode: intent.type,
        title:
          intent.type === "url"
            ? intent.content
            : intent.type === "text"
              ? "Shared recipe text"
              : "Shared recipe image",
        run: () => {
          if (intent.type === "url") {
            return parseFromUrl.mutateAsync({ url: intent.content });
          }
          if (intent.type === "text") {
            return parseFromText.mutateAsync({ text: intent.content });
          }
          return parseFromImage.mutateAsync({
            imageBase64: intent.content,
            mimeType,
          });
        },
      });
    },
    [parseFromImage, parseFromText, parseFromUrl, startImport],
  );

  const startBasicUrlImport = useCallback(
    (intent: PendingShareIntent) => {
      startImport({
        id: createBackgroundImportId("url"),
        mode: "url",
        title: intent.content,
        run: () => parseFromUrlBasic.mutateAsync({ url: intent.content }),
      });
    },
    [parseFromUrlBasic, startImport],
  );

  // Process a share intent (either new or pending)
  const processShareIntent = useCallback(
    async (intent: PendingShareIntent) => {
      const canUseSmartImport = await canUseSmartImportForShare();
      if (canUseSmartImport) {
        startSmartImport(intent);
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
        setPendingShareIntent(intent);
        resetShareIntent();
        navigateToAddRecipeTab();
        return;
      }

      startSmartImport(intent);
      clearPendingShareIntent();
      resetShareIntent();
      navigateToAddRecipeTab();
    },
    [
      canUseSmartImportForShare,
      navigateToAddRecipeTab,
      presentPaywall,
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
        processShareIntent(pendingIntent);
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

    // For image type, we need to convert file path to base64 first
    if (detectedIntent.type === "image") {
      (async () => {
        try {
          const { base64, mimeType } = await imageToBase64(
            detectedIntent.content,
          );
          processShareIntent({
            ...detectedIntent,
            content: base64,
            mimeType,
          });
        } catch (error) {
          console.error("Error converting image:", error);
          Alert.alert("Error", "Failed to process the shared image.");
          resetShareIntent();
        }
      })();
    } else {
      processShareIntent(detectedIntent);
    }
  }, [hasShareIntent, processShareIntent, resetShareIntent, shareIntent]);

  // Reset the processed flag when share intent is cleared
  useEffect(() => {
    if (!hasShareIntent) {
      hasProcessedRef.current = false;
    }
  }, [hasShareIntent]);

  return null;
}
