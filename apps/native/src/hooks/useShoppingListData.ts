import { useMemo } from "react";

import {
  groupShoppingList,
  type ShoppingListItem,
  type ShoppingListRecipe,
  type ShoppingListSection,
  type ShoppingListView,
} from "@/lib/shoppingListGroups";

export type { ShoppingListItem } from "@/lib/shoppingListGroups";

interface SectionHeaderRow {
  type: "section-header";
  id: string;
  title: string;
  recipe?: ShoppingListRecipe;
  isFirst: boolean;
}

interface ItemRow {
  type: "item";
  id: string;
  item: ShoppingListItem;
  isFirstInSection: boolean;
}

export type ShoppingListRow = SectionHeaderRow | ItemRow;

interface Options {
  items: ShoppingListItem[];
  recipes: ShoppingListRecipe[];
  view: ShoppingListView;
  /** Ticked items are hidden unless asked for. */
  showTicked: boolean;
}

/** The sections of the list, and the flat rows the FlatList renders. */
export const useShoppingListData = ({
  items,
  recipes,
  view,
  showTicked,
}: Options) => {
  const sections: ShoppingListSection[] = useMemo(
    () => groupShoppingList(items, recipes, view),
    [items, recipes, view],
  );

  const rows = useMemo(() => {
    const result: ShoppingListRow[] = [];
    for (const section of sections) {
      const visible = showTicked
        ? section.items
        : section.items.filter((i) => !i.isChecked);
      if (!visible.length) continue;
      result.push({
        type: "section-header",
        id: `header-${section.key}`,
        title: section.title,
        ...(section.recipe ? { recipe: section.recipe } : {}),
        isFirst: result.length === 0,
      });
      visible.forEach((item, index) =>
        result.push({
          type: "item",
          id: `item-${item.id}`,
          item,
          isFirstInSection: index === 0,
        }),
      );
    }
    return result;
  }, [sections, showTicked]);

  return { sections, rows };
};
