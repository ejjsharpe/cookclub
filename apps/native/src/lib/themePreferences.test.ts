import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyThemePreference,
  getThemePreference,
  setThemePreference,
} from "./themePreferences";

const mocks = vi.hoisted(() => ({
  getColorScheme: vi.fn(),
  getString: vi.fn(),
  set: vi.fn(),
  setAdaptiveThemes: vi.fn(),
  setColorScheme: vi.fn(),
  setTheme: vi.fn(),
}));

vi.mock("./mmkv", () => ({
  storage: {
    getString: mocks.getString,
    set: mocks.set,
  },
}));

vi.mock("react-native", () => ({
  Appearance: {
    getColorScheme: mocks.getColorScheme,
    setColorScheme: mocks.setColorScheme,
  },
}));

vi.mock("react-native-unistyles", () => ({
  UnistylesRuntime: {
    setAdaptiveThemes: mocks.setAdaptiveThemes,
    setTheme: mocks.setTheme,
  },
}));

describe("theme preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads valid preferences and falls back from missing or stale values", () => {
    mocks.getString.mockReturnValueOnce("dark");
    expect(getThemePreference()).toBe("dark");

    mocks.getString.mockReturnValueOnce("sepia");
    expect(getThemePreference()).toBe("system");

    mocks.getString.mockReturnValueOnce(undefined);
    expect(getThemePreference()).toBe("system");
  });

  it("persists the selected preference", () => {
    setThemePreference("light");

    expect(mocks.set).toHaveBeenCalledWith("theme_preference", "light");
  });

  it("applies an explicit theme and disables adaptive themes", () => {
    applyThemePreference("dark");

    expect(mocks.setAdaptiveThemes).toHaveBeenCalledWith(false);
    expect(mocks.setTheme).toHaveBeenCalledWith("dark");
    expect(mocks.setColorScheme).toHaveBeenCalledWith("dark");
  });

  it("resets overrides before applying the current system theme", () => {
    mocks.getColorScheme.mockReturnValue("dark");

    applyThemePreference("system");

    expect(mocks.setColorScheme).toHaveBeenNthCalledWith(1, "unspecified");
    expect(mocks.getColorScheme).toHaveBeenCalledOnce();
    expect(mocks.setAdaptiveThemes).toHaveBeenCalledWith(true);
    expect(mocks.setColorScheme).toHaveBeenNthCalledWith(2, "dark");
    expect(mocks.setTheme).not.toHaveBeenCalled();
  });

  it("uses light when the operating system has no color-scheme preference", () => {
    mocks.getColorScheme.mockReturnValue(null);

    applyThemePreference("system");

    expect(mocks.setColorScheme).toHaveBeenLastCalledWith("light");
  });
});
