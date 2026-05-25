import type { QueryClient } from "@tanstack/react-query";

import { clearSelectedMealPlan } from "./mealPlanPreferences";
import { storage } from "./mmkv";
import { clearPendingShareIntent } from "./pendingShareIntent";
import { queryPersister } from "./queryPersister";
import { clearSelectedShoppingList } from "./shoppingListPreferences";
import { applyThemePreference, setThemePreference } from "./themePreferences";

export async function clearLocalSessionState(queryClient: QueryClient) {
  await queryClient.cancelQueries();
  queryClient.setQueryData(["session"], null);
  queryClient.removeQueries({
    predicate: (query) => query.queryKey[0] !== "session",
  });
  await queryPersister.removeClient();
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
