import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Alert } from "react-native";
import { useMMKVString } from "react-native-mmkv";

import { storage } from "./mmkv";

const EXTERNAL_BROWSER_PREFERENCES = ["in_app", "system"] as const;
const EXTERNAL_BROWSER_PREFERENCE_KEY = "external_browser_preference";

export type ExternalBrowserPreference =
  (typeof EXTERNAL_BROWSER_PREFERENCES)[number];

let preferencePrompt: Promise<ExternalBrowserPreference | undefined> | null =
  null;

function isExternalBrowserPreference(
  value: string | undefined,
): value is ExternalBrowserPreference {
  return EXTERNAL_BROWSER_PREFERENCES.includes(
    value as ExternalBrowserPreference,
  );
}

export function getExternalBrowserPreference():
  ExternalBrowserPreference | undefined {
  const stored = storage.getString(EXTERNAL_BROWSER_PREFERENCE_KEY);
  return isExternalBrowserPreference(stored) ? stored : undefined;
}

export function setExternalBrowserPreference(
  preference: ExternalBrowserPreference,
): void {
  storage.set(EXTERNAL_BROWSER_PREFERENCE_KEY, preference);
}

/** Reactively reads the preference so Settings stays in sync with the chooser. */
export function useExternalBrowserPreference():
  ExternalBrowserPreference | undefined {
  const [stored] = useMMKVString(EXTERNAL_BROWSER_PREFERENCE_KEY, storage);
  return isExternalBrowserPreference(stored) ? stored : undefined;
}

function promptForExternalBrowserPreference(): Promise<
  ExternalBrowserPreference | undefined
> {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (preference?: ExternalBrowserPreference) => {
      if (settled) return;
      settled = true;

      if (preference) setExternalBrowserPreference(preference);
      resolve(preference);
    };

    Alert.alert(
      "Choose How to Open Websites",
      "Open websites inside cookclub or in your device's default browser? We’ll remember your choice.",
      [
        { text: "Cancel", style: "cancel", onPress: () => finish() },
        { text: "In App", onPress: () => finish("in_app") },
        { text: "Device Browser", onPress: () => finish("system") },
      ],
      { cancelable: true, onDismiss: () => finish() },
    );
  });
}

async function resolveExternalBrowserPreference(): Promise<
  ExternalBrowserPreference | undefined
> {
  const stored = getExternalBrowserPreference();
  if (stored) return stored;

  preferencePrompt ??= promptForExternalBrowserPreference().finally(() => {
    preferencePrompt = null;
  });

  return preferencePrompt;
}

/** Opens an HTTP(S) URL using the user's saved browser preference. */
export async function openExternalWebsite(url: string): Promise<boolean> {
  const preference = await resolveExternalBrowserPreference();
  if (!preference) return false;

  try {
    if (preference === "in_app") {
      await WebBrowser.openBrowserAsync(url);
    } else {
      await Linking.openURL(url);
    }
    return true;
  } catch (error) {
    console.error("Failed to open external website:", error);
    Alert.alert(
      "Unable to Open Website",
      "Something went wrong while opening the website. Please try again.",
    );
    return false;
  }
}
