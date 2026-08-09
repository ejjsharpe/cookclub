import { beforeEach, describe, expect, it, vi } from "vitest";

import { openExternalWebsite } from "./externalBrowser";

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  getString: vi.fn(),
  set: vi.fn(),
  openBrowserAsync: vi.fn(),
  openURL: vi.fn(),
}));

vi.mock("react-native", () => ({
  Alert: { alert: mocks.alert },
}));

vi.mock("expo-linking", () => ({
  openURL: mocks.openURL,
}));

vi.mock("expo-web-browser", () => ({
  openBrowserAsync: mocks.openBrowserAsync,
}));

vi.mock("react-native-mmkv", () => ({
  useMMKVString: vi.fn(),
}));

vi.mock("./mmkv", () => ({
  storage: {
    getString: mocks.getString,
    set: mocks.set,
  },
}));

describe("openExternalWebsite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getString.mockReturnValue(undefined);
  });

  it("asks once, saves the in-app choice, and opens the requested URL", async () => {
    const opening = openExternalWebsite("https://example.com/recipe");

    expect(mocks.alert).toHaveBeenCalledOnce();
    const buttons = mocks.alert.mock.calls[0]?.[2];
    const inAppButton = buttons.find(
      (button: { text: string }) => button.text === "In App",
    );
    inAppButton.onPress();

    await expect(opening).resolves.toBe(true);
    expect(mocks.set).toHaveBeenCalledWith(
      "external_browser_preference",
      "in_app",
    );
    expect(mocks.openBrowserAsync).toHaveBeenCalledWith(
      "https://example.com/recipe",
    );
    expect(mocks.openURL).not.toHaveBeenCalled();
  });

  it("uses a saved phone-browser choice without prompting again", async () => {
    mocks.getString.mockReturnValue("system");

    await expect(
      openExternalWebsite("https://example.com/terms"),
    ).resolves.toBe(true);

    expect(mocks.alert).not.toHaveBeenCalled();
    expect(mocks.openURL).toHaveBeenCalledWith("https://example.com/terms");
    expect(mocks.openBrowserAsync).not.toHaveBeenCalled();
  });

  it("does not save or open a website when the prompt is cancelled", async () => {
    const opening = openExternalWebsite("https://example.com/privacy");
    const buttons = mocks.alert.mock.calls[0]?.[2];
    const cancelButton = buttons.find(
      (button: { text: string }) => button.text === "Cancel",
    );
    cancelButton.onPress();

    await expect(opening).resolves.toBe(false);
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.openBrowserAsync).not.toHaveBeenCalled();
    expect(mocks.openURL).not.toHaveBeenCalled();
  });
});
