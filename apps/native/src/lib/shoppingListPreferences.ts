import { useCallback, useMemo } from "react";
import { useMMKVNumber, useMMKVString } from "react-native-mmkv";

import { storage } from "./mmkv";

const SELECTED_SHOPPING_LIST_ID_KEY = "selected_shopping_list_id";
const SELECTED_SHOPPING_LIST_NAME_KEY = "selected_shopping_list_name";

export function clearSelectedShoppingList(): void {
  storage.remove(SELECTED_SHOPPING_LIST_ID_KEY);
  storage.remove(SELECTED_SHOPPING_LIST_NAME_KEY);
}

/** Reactive hook for selected shopping list - auto-updates when MMKV changes */
export function useSelectedShoppingList() {
  const [id, setId] = useMMKVNumber(SELECTED_SHOPPING_LIST_ID_KEY, storage);
  const [name, setName] = useMMKVString(
    SELECTED_SHOPPING_LIST_NAME_KEY,
    storage,
  );

  const selectedList = useMemo(() => {
    if (id === undefined || name === undefined) return null;
    return { id, name };
  }, [id, name]);

  const setSelectedList = useCallback(
    (listId: number, listName: string) => {
      setId(listId);
      setName(listName);
    },
    [setId, setName],
  );

  const clearSelectedList = useCallback(() => {
    setId(undefined);
    setName(undefined);
  }, [setId, setName]);

  return { selectedList, setSelectedList, clearSelectedList };
}

const SHOPPING_LIST_VIEW_KEY = "shopping_list_view";

/** Whether the shopping list is grouped by aisle or by recipe. */
export function useShoppingListView() {
  const [stored, setStored] = useMMKVString(SHOPPING_LIST_VIEW_KEY, storage);
  const view: "aisle" | "recipe" = stored === "recipe" ? "recipe" : "aisle";
  const setView = useCallback(
    (next: "aisle" | "recipe") => setStored(next),
    [setStored],
  );
  return [view, setView] as const;
}
