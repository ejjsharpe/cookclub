import type { QueryClient } from "@tanstack/react-query";

import { clearSelectedMealPlan } from "./mealPlanPreferences";
import { storage } from "./mmkv";
import { clearPendingShareIntent } from "./pendingShareIntent";
import { clearSelectedShoppingList } from "./shoppingListPreferences";
import { applyThemePreference, setThemePreference } from "./themePreferences";

export function clearLocalSessionState(queryClient: QueryClient) {
  queryClient.clear();
  queryClient.setQueryData(["session"], null);
  storage.delete("cook-club-query-cache");
  storage.getAllKeys().forEach((key) => {
    if (key.startsWith("cookclub")) {
      storage.delete(key);
    }
  });
  clearSelectedMealPlan();
  clearSelectedShoppingList();
  clearPendingShareIntent();
  setThemePreference("system");
  applyThemePreference("system");
}
