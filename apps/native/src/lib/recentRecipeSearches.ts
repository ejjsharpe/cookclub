import type { PublicImageAsset } from "@repo/contracts/images";
import { useSyncExternalStore } from "react";

import { storage } from "./mmkv";

/** Something the user searched for or opened from library search. */
export type RecentRecipeSearch =
  | { type: "query"; text: string }
  | { type: "tag"; id: number; name: string }
  | {
      type: "recipe";
      id: number;
      name: string;
      totalTime: number | null;
      coverImage: PublicImageAsset | string | null;
    }
  | {
      type: "collection";
      id: number;
      name: string;
      recipeCount: number;
    };

const STORAGE_KEY = "recent_recipe_searches";
const MAX_RECENTS = 12;
const EMPTY: RecentRecipeSearch[] = [];

const listeners = new Set<() => void>();
let cached: RecentRecipeSearch[] | null = null;

/** Stable identity for a recent search, used for de-duplication and list keys. */
export function recentRecipeSearchKey(item: RecentRecipeSearch): string {
  return item.type === "query"
    ? `query:${item.text.trim().toLowerCase()}`
    : `${item.type}:${item.id}`;
}

function read(): RecentRecipeSearch[] {
  if (cached) return cached;
  try {
    const raw = storage.getString(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cached = Array.isArray(parsed) ? (parsed as RecentRecipeSearch[]) : EMPTY;
  } catch {
    cached = EMPTY;
  }
  return cached;
}

function write(items: RecentRecipeSearch[]) {
  cached = items;
  if (items.length === 0) {
    storage.remove(STORAGE_KEY);
  } else {
    storage.set(STORAGE_KEY, JSON.stringify(items));
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Moves the item to the top of the list, replacing any older copy. */
export function addRecentRecipeSearch(item: RecentRecipeSearch) {
  if (item.type === "query" && item.text.trim().length === 0) return;
  const key = recentRecipeSearchKey(item);
  write(
    [
      item,
      ...read().filter((existing) => recentRecipeSearchKey(existing) !== key),
    ].slice(0, MAX_RECENTS),
  );
}

export function removeRecentRecipeSearch(item: RecentRecipeSearch) {
  const key = recentRecipeSearchKey(item);
  write(read().filter((existing) => recentRecipeSearchKey(existing) !== key));
}

export function clearRecentRecipeSearches() {
  write(EMPTY);
}

export function useRecentRecipeSearches() {
  return useSyncExternalStore(subscribe, read, read);
}
