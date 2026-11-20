import type { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearLocalSessionState } from "./sessionCleanup";

const mocks = vi.hoisted(() => ({
  applyThemePreference: vi.fn(),
  cancelQueries: vi.fn(),
  clearPendingShareIntent: vi.fn(),
  clearRecentRecipeSearches: vi.fn(),
  clearSelectedMealPlan: vi.fn(),
  clearSelectedShoppingList: vi.fn(),
  getAllKeys: vi.fn(),
  remove: vi.fn(),
  removeClient: vi.fn(),
  removeQueries: vi.fn(),
  setQueryData: vi.fn(),
  setThemePreference: vi.fn(),
}));

vi.mock("./mealPlanPreferences", () => ({
  clearSelectedMealPlan: mocks.clearSelectedMealPlan,
}));

vi.mock("./mmkv", () => ({
  storage: {
    getAllKeys: mocks.getAllKeys,
    remove: mocks.remove,
  },
}));

vi.mock("./queryPersister", () => ({
  queryPersister: { removeClient: mocks.removeClient },
}));

vi.mock("./recentRecipeSearches", () => ({
  clearRecentRecipeSearches: mocks.clearRecentRecipeSearches,
}));

vi.mock("./shoppingListPreferences", () => ({
  clearSelectedShoppingList: mocks.clearSelectedShoppingList,
}));

vi.mock("./themePreferences", () => ({
  applyThemePreference: mocks.applyThemePreference,
  setThemePreference: mocks.setThemePreference,
}));

vi.mock("@/features/recipe-import/pendingShareIntent", () => ({
  clearPendingShareIntent: mocks.clearPendingShareIntent,
}));

function makeQueryClient(): QueryClient {
  const queryClient = Object.create(null) as QueryClient;
  queryClient.cancelQueries = mocks.cancelQueries;
  queryClient.removeQueries = mocks.removeQueries;
  queryClient.setQueryData = mocks.setQueryData;
  return queryClient;
}

describe("clearLocalSessionState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cancelQueries.mockResolvedValue(undefined);
    mocks.removeClient.mockResolvedValue(undefined);
    mocks.getAllKeys.mockReturnValue([
      "cookclub-auth-token",
      "cookclub-user-cache",
      "theme_preference",
    ]);
  });

  it("clears account-scoped caches while retaining the session query shell", async () => {
    const queryClient = makeQueryClient();

    await clearLocalSessionState(queryClient);

    expect(mocks.cancelQueries).toHaveBeenCalledOnce();
    expect(mocks.setQueryData).toHaveBeenCalledWith(["session"], null);
    expect(mocks.removeQueries).toHaveBeenCalledOnce();

    const predicate = mocks.removeQueries.mock.calls[0]?.[0]?.predicate;
    expect(predicate({ queryKey: ["session"] })).toBe(false);
    expect(predicate({ queryKey: ["recipes"] })).toBe(true);
    expect(mocks.removeClient).toHaveBeenCalledOnce();
    expect(mocks.remove).toHaveBeenCalledTimes(2);
    expect(mocks.remove).toHaveBeenNthCalledWith(1, "cookclub-auth-token");
    expect(mocks.remove).toHaveBeenNthCalledWith(2, "cookclub-user-cache");
  });

  it("resets feature selections, pending imports, recent searches, and theme state", async () => {
    const queryClient = makeQueryClient();

    await clearLocalSessionState(queryClient);

    expect(mocks.clearSelectedMealPlan).toHaveBeenCalledOnce();
    expect(mocks.clearSelectedShoppingList).toHaveBeenCalledOnce();
    expect(mocks.clearPendingShareIntent).toHaveBeenCalledOnce();
    expect(mocks.clearRecentRecipeSearches).toHaveBeenCalledOnce();
    expect(mocks.setThemePreference).toHaveBeenCalledWith("system");
    expect(mocks.applyThemePreference).toHaveBeenCalledWith("system");
  });
});
