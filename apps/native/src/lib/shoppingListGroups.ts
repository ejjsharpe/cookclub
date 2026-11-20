import { formatQuantity, getAisleOrder, type Aisle } from "@repo/shared";

// Grouping and plain-text export for the shopping list. Kept free of React so
// the list screen and the share sheet build from exactly the same sections.

export type ShoppingListView = "aisle" | "recipe";

export interface ShoppingListItem {
  id: number;
  ingredientName: string;
  displayName?: string;
  quantity: number;
  unit: string | null;
  displayText: string;
  isChecked: boolean;
  aisle: string;
  /** The rows merged into this item, newest first (as the server sends them). */
  sourceItems: {
    id: number;
    quantity: number | null;
    /** Missing from older servers; the merged item's state is used then. */
    isChecked?: boolean;
    sourceRecipeId: number | null;
    sourceRecipeName: string | null;
  }[];
}

export interface ShoppingListRecipe {
  id: number;
  name: string;
  imageUrl: string | null;
}

export interface ShoppingListSection {
  key: string;
  title: string;
  /** Set when the section is one recipe's ingredients. */
  recipe?: ShoppingListRecipe;
  items: ShoppingListItem[];
}

export const EXTRAS_TITLE = "Extras";

const capitalise = (text: string) =>
  text ? text.charAt(0).toUpperCase() + text.slice(1) : text;

/** "Limes", without the quantity. */
export const itemName = (item: ShoppingListItem) =>
  capitalise(item.displayName || item.ingredientName);

/** "3", "200 g", or "" when the recipe gave no amount. */
export const itemQuantity = (item: ShoppingListItem) => {
  const amount = formatQuantity(item.quantity);
  if (!amount) return "";
  return item.unit ? `${amount} ${item.unit}` : amount;
};

/** Oldest first, so the recipe that first added an item leads. */
const sourcesOldestFirst = (item: ShoppingListItem) =>
  [...item.sourceItems].reverse();

/** Recipes the item came from, in the order it was added from them. */
export const itemRecipeNames = (item: ShoppingListItem) => [
  ...new Set(
    sourcesOldestFirst(item)
      .map((s) => s.sourceRecipeName)
      .filter((name): name is string => !!name),
  ),
];

/**
 * What's still to get of a partly ticked item: with pad thai's onion bought,
 * "Onions 3" becomes "Onions 2". Untouched and fully ticked items are as-is.
 */
const stillToGet = (item: ShoppingListItem): ShoppingListItem => {
  const left = item.sourceItems.filter((s) => !(s.isChecked ?? item.isChecked));
  if (item.isChecked || left.length === item.sourceItems.length) return item;
  return {
    ...item,
    quantity: left.reduce((sum, s) => sum + (s.quantity ?? 0), 0),
  };
};

const groupByAisle = (items: ShoppingListItem[]): ShoppingListSection[] => {
  const groups = new Map<string, ShoppingListItem[]>();
  for (const original of items) {
    const item = stillToGet(original);
    const aisle = item.aisle || "Other";
    groups.set(aisle, [...(groups.get(aisle) ?? []), item]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => getAisleOrder(a as Aisle) - getAisleOrder(b as Aisle))
    .map(([aisle, aisleItems]) => ({
      key: `aisle-${aisle}`,
      title: aisle,
      items: aisleItems,
    }));
};

// Each recipe lists its own amounts: 2 onions for one and 1 for another
// show as two rows, not one row of 3 under whichever came first. Each row
// stands for just that recipe's line, so ticking or deleting it leaves the
// other recipe's onions alone. Items typed in by hand go under Extras.
const groupByRecipe = (
  items: ShoppingListItem[],
  recipes: ShoppingListRecipe[],
): ShoppingListSection[] => {
  const sections = new Map<string, ShoppingListSection>();
  for (const recipe of recipes) {
    sections.set(`recipe-${recipe.id}`, {
      key: `recipe-${recipe.id}`,
      title: recipe.name,
      recipe,
      items: [],
    });
  }
  const extras: ShoppingListItem[] = [];

  for (const item of items) {
    for (const source of sourcesOldestFirst(item)) {
      const row: ShoppingListItem = {
        ...item,
        id: source.id,
        quantity: source.quantity ?? 0,
        isChecked: source.isChecked ?? item.isChecked,
        sourceItems: [source],
      };
      if (source.sourceRecipeId == null) {
        extras.push(row);
        continue;
      }
      const key = `recipe-${source.sourceRecipeId}`;
      let section = sections.get(key);
      if (!section) {
        // The recipe was removed from the list but some of its items stayed.
        section = {
          key,
          title: source.sourceRecipeName ?? EXTRAS_TITLE,
          items: [],
        };
        sections.set(key, section);
      }
      section.items.push(row);
    }
  }

  const result = [...sections.values()].filter((s) => s.items.length > 0);
  if (extras.length) {
    result.push({ key: "extras", title: EXTRAS_TITLE, items: extras });
  }
  return result;
};

export const groupShoppingList = (
  items: ShoppingListItem[],
  recipes: ShoppingListRecipe[],
  view: ShoppingListView,
): ShoppingListSection[] =>
  view === "recipe" ? groupByRecipe(items, recipes) : groupByAisle(items);

export interface ShoppingListTextOptions {
  includeTicked: boolean;
  /** Add the recipe after each item. Only used when grouped by aisle. */
  showRecipe: boolean;
}

/** One line per item in the section, as it appears in the shared text. */
export const sectionLines = (
  section: ShoppingListSection,
  { includeTicked, showRecipe }: ShoppingListTextOptions,
): string[] =>
  section.items
    .filter((item) => includeTicked || !item.isChecked)
    .map((item) => {
      const quantity = itemQuantity(item);
      const name = item.displayName || item.ingredientName;
      let line = quantity ? `${quantity} ${name}` : capitalise(name);
      if (showRecipe && !section.recipe) {
        const recipes = itemRecipeNames(item);
        if (recipes.length) line += ` (${recipes.join(", ")})`;
      }
      return item.isChecked ? `✓ ${line}` : line;
    });

/**
 * The list as plain text for the share sheet: the list name, then each
 * section's heading followed by one line per item.
 */
export const shoppingListText = (
  listName: string,
  sections: ShoppingListSection[],
  options: ShoppingListTextOptions,
): string => {
  const blocks = sections
    .map((section) => [section.title, ...sectionLines(section, options)])
    .filter((block) => block.length > 1)
    .map((block) => block.join("\n"));
  return [listName, ...blocks].join("\n\n");
};

export const countShareableItems = (
  sections: ShoppingListSection[],
  includeTicked: boolean,
) =>
  sections.reduce(
    (sum, s) =>
      sum + s.items.filter((i) => includeTicked || !i.isChecked).length,
    0,
  );

/** Every ticked row (each recipe's share) across the merged items. */
export const tickedRowIds = (items: ShoppingListItem[]): number[] =>
  items.flatMap((item) =>
    item.sourceItems
      .filter((source) => source.isChecked ?? item.isChecked)
      .map((source) => source.id),
  );

/** The rows that came from one recipe. */
export const recipeRowIds = (
  items: ShoppingListItem[],
  recipeId: number,
): number[] =>
  items.flatMap((item) =>
    item.sourceItems
      .filter((source) => source.sourceRecipeId === recipeId)
      .map((source) => source.id),
  );

/** The merged item that holds a row, by the row's or the item's own id. */
export const findItemForRow = (items: ShoppingListItem[], rowId: number) =>
  items.find(
    (item) =>
      item.id === rowId ||
      item.sourceItems.some((source) => source.id === rowId),
  );

/** Tick or untick the given rows, wherever they sit in the merged items. */
export const tickRows = (
  items: ShoppingListItem[],
  rowIds: number[],
  isChecked: boolean,
): ShoppingListItem[] => {
  const ids = new Set(rowIds);
  return items.map((item) => {
    if (!item.sourceItems.some((s) => ids.has(s.id)) && !ids.has(item.id)) {
      return item;
    }
    const sourceItems = item.sourceItems.map((s) =>
      ids.has(s.id) ? { ...s, isChecked } : s,
    );
    return {
      ...item,
      sourceItems,
      // Ticked once every recipe's share is, as the server works it out
      isChecked: sourceItems.every((s) => s.isChecked ?? item.isChecked),
    };
  });
};

/**
 * Take the given rows off the list. A merged item loses just those recipes'
 * share, and goes once nothing is left of it.
 */
export const removeRows = (
  items: ShoppingListItem[],
  rowIds: number[],
): ShoppingListItem[] => {
  const ids = new Set(rowIds);
  return items.flatMap((item) => {
    const kept = item.sourceItems.filter((s) => !ids.has(s.id));
    if (kept.length === item.sourceItems.length && !ids.has(item.id)) {
      return [item];
    }
    const first = kept[0];
    if (!first) return [];
    const removed = item.sourceItems
      .filter((s) => ids.has(s.id))
      .reduce((sum, s) => sum + (s.quantity ?? 0), 0);
    return [
      {
        ...item,
        // The server keys a merged item by its newest row
        id: first.id,
        quantity: Math.max(0, item.quantity - removed),
        sourceItems: kept,
      },
    ];
  });
};
