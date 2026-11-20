import type { QueryClient } from "@tanstack/react-query";

import { clearSelectedMealPlan } from "./mealPlanPreferences";
import { storage } from "./mmkv";
import { queryPersister } from "./queryPersister";
import { clearRecentRecipeSearches } from "./recentRecipeSearches";
import { clearSelectedShoppingList } from "./shoppingListPreferences";
import { applyThemePreference, setThemePreference } from "./themePreferences";

import { clearPendingShareIntent } from "@/features/recipe-import/pendingShareIntent";

export async function clearLocalSessionState(queryClient: QueryClient) {
  await queryClient.cancelQueries();
  queryClient.setQueryData(["session"], null);
  queryClient.removeQueries({
    predicate: (query) => query.queryKey[0] !== "session",
  });
  await queryPersister.removeClient();
  storage.getAllKeys().forEach((key) => {
    if (key.startsWith("cookclub")) {
      storage.remove(key);
    }
  });
  clearSelectedMealPlan();
  clearSelectedShoppingList();
  clearPendingShareIntent();
  clearRecentRecipeSearches();
  setThemePreference("system");
  applyThemePreference("system");
}
