import { isBasicImportUnsupportedUrl } from "@repo/contracts/recipe-import";
import { useShareIntentContext } from "expo-share-intent";
import { useCallback, useEffect, useRef } from "react";
import { Alert } from "react-native";

import { useRecipeImport } from "./RecipeImportProvider";
import {
  clearPendingShareIntent,
  getPendingShareIntent,
  persistDetectedShareIntent,
  type PendingShareIntent,
  updatePendingShareIntent,
} from "./pendingShareIntent";

import { useIsSignedIn } from "@/lib/signedInContext";
import { useSubscription } from "@/lib/subscription";
import { navigationRef } from "@/navigation/navigationRef";
import { detectPendingShareIntent } from "@/utils/shareIntent";

export function ShareIntentImportHandler() {
  const { hasShareIntent, shareIntent, resetShareIntent } =
    useShareIntentContext();
  const isSignedIn = useIsSignedIn();
  const { submitImport, uploadImportSource } = useRecipeImport();
  const { status, isPro, presentPaywall, refresh } = useSubscription();
  const capturedShareRef = useRef(false);
  const attemptedPendingIdRef = useRef<string | null>(null);

  const navigateToImports = useCallback(() => {
    if (navigationRef.isReady()) {
      navigationRef.navigate("Tabs", { screen: "Add recipe" });
    }
  }, []);

  const canUseSmartImport = useCallback(async () => {
    if (isPro || (status?.smartImports.remaining ?? 0) > 0) return true;
    try {
      const refreshed = await refresh();
      return Boolean(
        refreshed?.isPro || (refreshed?.smartImports.remaining ?? 0) > 0,
      );
    } catch {
      return false;
    }
  }, [isPro, refresh, status?.smartImports.remaining]);

  const submitPending = useCallback(
    async (record: PendingShareIntent) => {
      if (!isSignedIn) return false;

      let importType: "basic" | "smart";
      if (await canUseSmartImport()) {
        importType = "smart";
      } else if (
        record.type === "url" &&
        !isBasicImportUnsupportedUrl(record.value)
      ) {
        importType = "basic";
      } else {
        const upgraded = await presentPaywall();
        if (!upgraded) return false;
        importType = "smart";
      }

      updatePendingShareIntent(record.id, { importType });
      if (record.type === "image") {
        const uploadKey =
          record.uploadKey ?? (await uploadImportSource(record.fileUri));
        updatePendingShareIntent(record.id, { uploadKey });
        await submitImport({
          id: record.id,
          importType: "smart",
          source: { type: "image", uploadKey },
        });
      } else {
        if (importType === "basic") {
          await submitImport({
            id: record.id,
            importType: "basic",
            source: { type: "url", value: record.value },
          });
        } else {
          await submitImport({
            id: record.id,
            importType: "smart",
            source: { type: record.type, value: record.value },
          });
        }
      }

      clearPendingShareIntent(record.id);
      navigateToImports();
      return true;
    },
    [
      canUseSmartImport,
      isSignedIn,
      navigateToImports,
      presentPaywall,
      submitImport,
      uploadImportSource,
    ],
  );

  const attemptPending = useCallback(
    function attemptPending(record: PendingShareIntent) {
      attemptedPendingIdRef.current = record.id;

      const pauseImport = (error?: unknown) => {
        if (attemptedPendingIdRef.current === record.id) {
          attemptedPendingIdRef.current = null;
        }
        if (error !== undefined) {
          console.error("Shared recipe import remains queued:", error);
        }
        Alert.alert(
          "Import paused",
          "We kept the shared recipe so you can try again without sharing it again.",
          [
            { text: "Later", style: "cancel" },
            {
              text: "Retry",
              onPress: () => {
                const pending = getPendingShareIntent();
                if (pending?.id === record.id) attemptPending(pending);
              },
            },
          ],
        );
      };

      submitPending(record)
        .then((submitted) => {
          if (!submitted) {
            pauseImport();
          } else if (attemptedPendingIdRef.current === record.id) {
            attemptedPendingIdRef.current = null;
          }
        })
        .catch(pauseImport);
    },
    [submitPending],
  );

  useEffect(() => {
    if (!hasShareIntent || !shareIntent || capturedShareRef.current) return;
    const detected = detectPendingShareIntent(shareIntent);
    if (!detected) {
      resetShareIntent();
      return;
    }

    capturedShareRef.current = true;
    persistDetectedShareIntent(detected)
      .then((record) => {
        // Image files are app-owned before the platform share is reset.
        resetShareIntent();
        if (!isSignedIn) {
          Alert.alert(
            "Sign in required",
            "Sign in to continue importing this recipe.",
          );
          return;
        }
        attemptPending(record);
      })
      .catch((error) => {
        console.error("Failed to preserve shared recipe:", error);
        Alert.alert(
          "Share Error",
          "The shared recipe could not be saved. Please try again.",
        );
      });
  }, [
    hasShareIntent,
    isSignedIn,
    resetShareIntent,
    shareIntent,
    attemptPending,
  ]);

  useEffect(() => {
    if (!hasShareIntent) capturedShareRef.current = false;
  }, [hasShareIntent]);

  useEffect(() => {
    if (!isSignedIn) return;
    const pending = getPendingShareIntent();
    if (!pending || attemptedPendingIdRef.current === pending.id) return;
    attemptPending(pending);
  }, [attemptPending, isSignedIn]);

  return null;
}
