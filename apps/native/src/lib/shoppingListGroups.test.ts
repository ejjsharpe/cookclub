import { describe, expect, it } from "vitest";

import {
  countShareableItems,
  groupShoppingList,
  itemName,
  itemQuantity,
  removeRows,
  shoppingListText,
  findItemForRow,
  recipeRowIds,
  tickedRowIds,
  tickRows,
  type ShoppingListItem,
} from "./shoppingListGroups";

let nextId = 1;

/**
 * A merged item as the server sends it. Each source is [recipeId, recipe
 * name, quantity, ticked], newest first; a null recipe is a hand-added row.
 */
const item = (
  name: string,
  unit: string | null,
  aisle: string,
  sources: [number | null, string | null, number, boolean?][],
): ShoppingListItem => {
  const sourceItems = sources.map(
    ([recipeId, recipeName, quantity, ticked]) => ({
      id: nextId++,
      quantity,
      isChecked: ticked ?? false,
      sourceRecipeId: recipeId,
      sourceRecipeName: recipeName,
    }),
  );
  const quantity = sources.reduce((sum, [, , q]) => sum + q, 0);
  return {
    // The server keys a merged item by its newest row
    id: sourceItems[0]!.id,
    ingredientName: name,
    displayName: name,
    quantity,
    unit,
    displayText: `${quantity} ${unit ?? ""} ${name}`,
    // The server marks a merged item ticked once every row is
    isChecked: sourceItems.every((s) => s.isChecked),
    aisle,
    sourceItems,
  };
};

const padThai = { id: 1, name: "Prawn pad thai", imageUrl: null };
const curry = { id: 2, name: "Butter chicken", imageUrl: null };

// Butter chicken added 2 onions after pad thai added 1
const onions = item("onions", null, "Fresh Produce", [
  [2, "Butter chicken", 2],
  [1, "Prawn pad thai", 1],
]);
const prawns = item("king prawns", "g", "Meat & Seafood", [
  [1, "Prawn pad thai", 300],
]);
const butter = item("butter", "g", "Dairy", [[2, "Butter chicken", 50, true]]);
const soap = item("washing-up liquid", null, "Other", [[null, null, 0]]);
const items = [soap, butter, prawns, onions];

describe("itemName and itemQuantity", () => {
  it("splits the name from the amount", () => {
    expect(itemName(onions)).toBe("Onions");
    expect(itemQuantity(onions)).toBe("3");
    expect(itemQuantity(prawns)).toBe("300 g");
    expect(itemQuantity(soap)).toBe("");
  });
});

describe("groupShoppingList", () => {
  it("groups by aisle in shop order, with merged amounts", () => {
    const sections = groupShoppingList(items, [padThai, curry], "aisle");
    expect(sections.map((s) => s.title)).toEqual([
      "Fresh Produce",
      "Meat & Seafood",
      "Dairy",
      "Other",
    ]);
    expect(itemQuantity(sections[0]!.items[0]!)).toBe("3");
  });

  it("splits a shared item back into each recipe's own amount", () => {
    const sections = groupShoppingList(items, [padThai, curry], "recipe");
    expect(
      sections.map((s) => [
        s.title,
        s.items.map((i) => `${itemQuantity(i)} ${itemName(i)}`.trim()),
      ]),
    ).toEqual([
      ["Prawn pad thai", ["300 g King prawns", "1 Onions"]],
      ["Butter chicken", ["50 g Butter", "2 Onions"]],
      ["Extras", ["Washing-up liquid"]],
    ]);
    // Each split row stands for just its own recipe's line
    const padThaiOnions = sections[0]!.items[1]!;
    expect(padThaiOnions.sourceItems).toHaveLength(1);
    expect(padThaiOnions.id).toBe(padThaiOnions.sourceItems[0]!.id);
    expect(sections[0]?.recipe).toBe(padThai);
  });

  it("keeps items whose recipe has left the list", () => {
    const sections = groupShoppingList([prawns], [], "recipe");
    expect(sections.map((s) => s.title)).toEqual(["Prawn pad thai"]);
    expect(sections[0]?.recipe).toBeUndefined();
  });
});

describe("ticking and removing rows", () => {
  const padThaiOnionId = onions.sourceItems[1]!.id;

  it("only counts a merged item ticked once every recipe's share is", () => {
    const oneTicked = tickRows([onions], [padThaiOnionId], true);
    expect(oneTicked[0]!.isChecked).toBe(false);
    // ...but that share shows ticked in By recipe
    const byRecipe = groupShoppingList(oneTicked, [padThai, curry], "recipe");
    expect(byRecipe[0]!.items[0]!.isChecked).toBe(true);

    const allTicked = tickRows(
      [onions],
      onions.sourceItems.map((s) => s.id),
      true,
    );
    expect(allTicked[0]!.isChecked).toBe(true);
  });

  it("shows only what's left to get of a partly ticked item by aisle", () => {
    const oneTicked = tickRows([onions], [padThaiOnionId], true);
    const [section] = groupShoppingList(oneTicked, [], "aisle");
    expect(itemQuantity(section!.items[0]!)).toBe("2");
  });

  it("clears only the ticked shares, leaving the rest to get", () => {
    const oneTicked = tickRows([onions, prawns], [padThaiOnionId], true);
    const ticked = tickedRowIds(oneTicked);
    expect(ticked).toEqual([padThaiOnionId]);
    const [left, stillPrawns] = removeRows(oneTicked, ticked);
    expect(left?.quantity).toBe(2);
    expect(left?.isChecked).toBe(false);
    expect(stillPrawns).toBe(oneTicked[1]);
  });

  it("removes one recipe's share of every item", () => {
    const left = removeRows(items, recipeRowIds(items, padThai.id));
    // Prawns came only from pad thai; onions keep butter chicken's 2
    expect(
      left.map((i) => `${itemQuantity(i)} ${i.ingredientName}`.trim()),
    ).toEqual(["washing-up liquid", "50 g butter", "2 onions"]);
    expect(
      groupShoppingList(left, [curry], "recipe").map((s) => s.title),
    ).toEqual(["Butter chicken", "Extras"]);
  });

  it("finds an item by one of its rows", () => {
    expect(findItemForRow(items, padThaiOnionId)).toBe(onions);
    expect(findItemForRow(items, onions.id)).toBe(onions);
  });

  it("takes one recipe's share off a merged item", () => {
    const [left] = removeRows([onions], [padThaiOnionId]);
    expect(left?.quantity).toBe(2);
    expect(left?.sourceItems.map((s) => s.sourceRecipeName)).toEqual([
      "Butter chicken",
    ]);
    expect(
      removeRows(
        [onions],
        onions.sourceItems.map((s) => s.id),
      ),
    ).toEqual([]);
  });
});

describe("shoppingListText", () => {
  const sections = groupShoppingList(items, [padThai, curry], "aisle");

  it("leaves ticked items out by default", () => {
    expect(
      shoppingListText("Weekly shop", sections, {
        includeTicked: false,
        showRecipe: false,
      }),
    ).toBe(
      [
        "Weekly shop",
        "Fresh Produce\n3 onions",
        "Meat & Seafood\n300 g king prawns",
        "Other\nWashing-up liquid",
      ].join("\n\n"),
    );
    expect(countShareableItems(sections, false)).toBe(3);
  });

  it("can mark ticked items and name the recipes, oldest first", () => {
    const text = shoppingListText("Weekly shop", sections, {
      includeTicked: true,
      showRecipe: true,
    });
    expect(text).toContain("3 onions (Prawn pad thai, Butter chicken)");
    expect(text).toContain("Dairy\n✓ 50 g butter (Butter chicken)");
    expect(countShareableItems(sections, true)).toBe(4);
  });

  it("shares each recipe's own amounts when grouped by recipe", () => {
    const text = shoppingListText(
      "Weekly shop",
      groupShoppingList(items, [padThai, curry], "recipe"),
      { includeTicked: false, showRecipe: false },
    );
    expect(text).toContain("Prawn pad thai\n300 g king prawns\n1 onions");
    expect(text).toContain("Butter chicken\n2 onions");
  });
});
