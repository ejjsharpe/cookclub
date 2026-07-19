import { useShareIntentContext } from "expo-share-intent";
import { useEffect, useRef } from "react";
import { Alert } from "react-native";

import { isAdaptyConfigured } from "@/lib/adapty";
import {
  clearPendingShareIntent,
  setPendingShareIntent,
} from "@/lib/pendingShareIntent";
import { useIsSignedIn } from "@/lib/signedInContext";
import { imageToBase64 } from "@/utils/imageUtils";
import { detectPendingShareIntent } from "@/utils/shareIntent";

/**
 * This component handles share intents when the user is NOT signed in.
 * It stores the intent to MMKV so it can be processed after login.
 *
 * This runs at the App level (outside NavigationContainer) so it can
 * capture share intents even before the user signs in.
 */
export function ShareIntentStorageHandler() {
  const { hasShareIntent, shareIntent, resetShareIntent } =
    useShareIntentContext();
  const isSignedIn = useIsSignedIn();
  const hasProcessedRef = useRef(false);

  // Only handle share intents when NOT signed in
  // When signed in, the ShareIntentHandler inside TabNavigator handles it
  useEffect(() => {
    if (!isAdaptyConfigured()) {
      clearPendingShareIntent();
      if (hasShareIntent) resetShareIntent();
      return;
    }

    if (isSignedIn) return; // Let the other handler deal with it
    if (!hasShareIntent || !shareIntent || hasProcessedRef.current) return;

    const detectedIntent = detectPendingShareIntent(shareIntent);
    if (!detectedIntent) {
      resetShareIntent();
      return;
    }

    hasProcessedRef.current = true;

    // Store for later processing after login
    if (detectedIntent.type === "image") {
      // For images, we need to convert to base64 before storing
      (async () => {
        try {
          const { base64, mimeType } = await imageToBase64(
            detectedIntent.content,
          );
          setPendingShareIntent({
            ...detectedIntent,
            content: base64,
            mimeType,
            isBase64: true,
          });
        } catch (error) {
          console.error("Error storing image intent:", error);
        }
      })();
    } else {
      setPendingShareIntent(detectedIntent);
    }

    Alert.alert(
      "Sign in required",
      "Please sign in to import this recipe. It will be processed automatically after you sign in.",
      [{ text: "OK" }],
    );
    resetShareIntent();
  }, [hasShareIntent, shareIntent, isSignedIn]);

  // Reset the processed flag when share intent is cleared
  useEffect(() => {
    if (!hasShareIntent) {
      hasProcessedRef.current = false;
    }
  }, [hasShareIntent]);

  return null;
}
