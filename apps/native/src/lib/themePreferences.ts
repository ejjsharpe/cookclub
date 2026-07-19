import { Appearance } from "react-native";
import { UnistylesRuntime } from "react-native-unistyles";

import { storage } from "./mmkv";

const THEME_PREFERENCES = ["light", "dark", "system"] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

const THEME_PREFERENCE_KEY = "theme_preference";

function isThemePreference(
  value: string | undefined,
): value is ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference);
}

function getSystemColorScheme(): "light" | "dark" {
  // Clear any previous app override before reading the device preference.
  Appearance.setColorScheme("unspecified");

  return Appearance.getColorScheme() === "dark" ? "dark" : "light";
}

export function getThemePreference(): ThemePreference {
  const stored = storage.getString(THEME_PREFERENCE_KEY);
  return isThemePreference(stored) ? stored : "system";
}

export function setThemePreference(theme: ThemePreference): void {
  storage.set(THEME_PREFERENCE_KEY, theme);
}

export function applyThemePreference(preference: ThemePreference): void {
  if (preference === "system") {
    const systemScheme = getSystemColorScheme();
    UnistylesRuntime.setAdaptiveThemes(true);
    Appearance.setColorScheme(systemScheme);
  } else {
    UnistylesRuntime.setAdaptiveThemes(false);
    UnistylesRuntime.setTheme(preference);
    Appearance.setColorScheme(preference);
  }
}
