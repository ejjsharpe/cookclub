import * as ImagePicker from "expo-image-picker";
import type { PermissionResponse } from "expo-image-picker";
import { Alert, Linking } from "react-native";

type PermissionOptions = {
  message: string;
  errorMessage: string;
};

const waitForPermissionSheetDismissal = () =>
  new Promise((resolve) => setTimeout(resolve, 300));

const showPermissionAlert = (message: string, canAskAgain: boolean) => {
  Alert.alert(
    "Permission Required",
    message,
    canAskAgain
      ? undefined
      : [
          { text: "Cancel", style: "cancel" },
          {
            text: "Open Settings",
            onPress: () => {
              Linking.openSettings().catch((error) => {
                console.error("Failed to open app settings:", error);
              });
            },
          },
        ],
  );
};

const ensurePermission = async ({
  getPermission,
  requestPermission,
  message,
  errorMessage,
}: PermissionOptions & {
  getPermission: () => Promise<PermissionResponse>;
  requestPermission: () => Promise<PermissionResponse>;
}) => {
  try {
    const currentPermission = await getPermission();
    const shouldRequestPermission = !currentPermission.granted;
    const permissionResult = !shouldRequestPermission
      ? currentPermission
      : await requestPermission();

    if (!permissionResult.granted) {
      showPermissionAlert(message, permissionResult.canAskAgain);
      return false;
    }

    if (shouldRequestPermission) {
      await waitForPermissionSheetDismissal();
    }

    return true;
  } catch (error) {
    console.error("Failed to request image picker permission:", error);
    Alert.alert("Permission Error", errorMessage);
    return false;
  }
};

export const ensureMediaLibraryPermission = (
  options?: Partial<PermissionOptions>,
) =>
  ensurePermission({
    getPermission: () => ImagePicker.getMediaLibraryPermissionsAsync(),
    requestPermission: () => ImagePicker.requestMediaLibraryPermissionsAsync(),
    message:
      options?.message ??
      "Please allow access to your photos to choose an image.",
    errorMessage:
      options?.errorMessage ?? "Unable to access your photo library.",
  });

export const ensureCameraPermission = (options?: Partial<PermissionOptions>) =>
  ensurePermission({
    getPermission: () => ImagePicker.getCameraPermissionsAsync(),
    requestPermission: () => ImagePicker.requestCameraPermissionsAsync(),
    message: options?.message ?? "Please allow camera access to take photos.",
    errorMessage: options?.errorMessage ?? "Unable to access your camera.",
  });
