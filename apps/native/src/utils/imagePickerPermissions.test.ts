import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ensureCameraPermission,
  ensureMediaLibraryPermission,
} from "./imagePickerPermissions";

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  getCamera: vi.fn(),
  getMediaLibrary: vi.fn(),
  openSettings: vi.fn(),
  requestCamera: vi.fn(),
  requestMediaLibrary: vi.fn(),
}));

vi.mock("expo-image-picker", () => ({
  getCameraPermissionsAsync: mocks.getCamera,
  getMediaLibraryPermissionsAsync: mocks.getMediaLibrary,
  requestCameraPermissionsAsync: mocks.requestCamera,
  requestMediaLibraryPermissionsAsync: mocks.requestMediaLibrary,
}));

vi.mock("react-native", () => ({
  Alert: { alert: mocks.alert },
  Linking: { openSettings: mocks.openSettings },
}));

const grantedPermission = {
  canAskAgain: true,
  expires: "never" as const,
  granted: true,
  status: "granted" as const,
};

describe("image picker permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("returns immediately when media-library permission is already granted", async () => {
    mocks.getMediaLibrary.mockResolvedValue(grantedPermission);

    await expect(ensureMediaLibraryPermission()).resolves.toBe(true);
    expect(mocks.requestMediaLibrary).not.toHaveBeenCalled();
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it("requests missing camera permission and waits for the native sheet to dismiss", async () => {
    vi.useFakeTimers();
    mocks.getCamera.mockResolvedValue({
      ...grantedPermission,
      granted: false,
      status: "undetermined",
    });
    mocks.requestCamera.mockResolvedValue(grantedPermission);

    const permission = ensureCameraPermission();
    await vi.advanceTimersByTimeAsync(300);

    await expect(permission).resolves.toBe(true);
    expect(mocks.requestCamera).toHaveBeenCalledOnce();
  });

  it("shows a custom denial message while permission can still be requested", async () => {
    mocks.getMediaLibrary.mockResolvedValue({
      ...grantedPermission,
      granted: false,
      status: "denied",
    });
    mocks.requestMediaLibrary.mockResolvedValue({
      ...grantedPermission,
      granted: false,
      status: "denied",
    });

    await expect(
      ensureMediaLibraryPermission({ message: "Photos are needed." }),
    ).resolves.toBe(false);
    expect(mocks.alert).toHaveBeenCalledWith(
      "Permission Required",
      "Photos are needed.",
      undefined,
    );
  });

  it("offers settings when the camera permission cannot be requested again", async () => {
    mocks.getCamera.mockResolvedValue({
      ...grantedPermission,
      canAskAgain: false,
      granted: false,
      status: "denied",
    });
    mocks.requestCamera.mockResolvedValue({
      ...grantedPermission,
      canAskAgain: false,
      granted: false,
      status: "denied",
    });
    mocks.openSettings.mockResolvedValue(undefined);

    await expect(ensureCameraPermission()).resolves.toBe(false);
    const buttons = mocks.alert.mock.calls[0]?.[2];
    expect(buttons).toEqual([
      { text: "Cancel", style: "cancel" },
      { text: "Open Settings", onPress: expect.any(Function) },
    ]);

    buttons?.[1]?.onPress?.();
    expect(mocks.openSettings).toHaveBeenCalledOnce();
  });

  it("turns permission API failures into a user-facing error", async () => {
    const error = new Error("native permission API unavailable");
    mocks.getCamera.mockRejectedValue(error);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(
      ensureCameraPermission({ errorMessage: "Camera is unavailable." }),
    ).resolves.toBe(false);
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to request image picker permission:",
      error,
    );
    expect(mocks.alert).toHaveBeenCalledWith(
      "Permission Error",
      "Camera is unavailable.",
    );

    consoleError.mockRestore();
  });
});
