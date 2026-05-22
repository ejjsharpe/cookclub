import { onlineManager } from "@tanstack/react-query";
import * as Network from "expo-network";
import { AppState } from "react-native";

export function setupOnlineManager() {
  const updateOnlineStatus = async () => {
    const state = await Network.getNetworkStateAsync();
    onlineManager.setOnline(state.isConnected === true);
  };

  updateOnlineStatus();

  // Re-check when app comes to foreground
  const subscription = AppState.addEventListener("change", (status) => {
    if (status === "active") updateOnlineStatus();
  });

  return () => subscription.remove();
}
