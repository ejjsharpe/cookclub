import { describe, expect, it } from "vitest";

import {
  extractPreparation,
  formatQuantity,
  normalizeIngredientName,
  parseIngredient,
  parseIngredients,
} from "./ingredientParser";

describe("ingredient parsing", () => {
  it("parses fractions and prefers the most specific preparation phrase", () => {
    expect(parseIngredient("1/2 cup red onions, finely chopped")).toEqual({
      quantity: 0.5,
      unit: "cup",
      name: "red onions",
      preparation: "finely chopped",
      confidence: "high",
      originalText: "1/2 cup red onions, finely chopped",
    });
  });

  it("parses a quantity without inventing a unit", () => {
    expect(parseIngredient("2 eggs")).toMatchObject({
      quantity: 2,
      unit: null,
      name: "eggs",
      confidence: "medium",
    });
  });

  it("still extracts preparation when quantity parsing is unavailable", () => {
    expect(parseIngredient("fresh parsley, roughly chopped")).toMatchObject({
      quantity: null,
      unit: null,
      name: "fresh parsley",
      preparation: "roughly chopped",
      confidence: "low",
    });
  });

  it("handles empty input and preserves the original trimmed text", () => {
    expect(parseIngredient("")).toEqual({
      quantity: null,
      unit: null,
      name: "",
      preparation: null,
      confidence: "low",
      originalText: "",
    });
    expect(parseIngredient("  1.5 tbsp oil  ").originalText).toBe(
      "1.5 tbsp oil",
    );
  });

  it.each([
    ["4 burger buns", 4, null, "burger buns"],
    ["1 red onion", 1, null, "red onion"],
    ["2 large eggs", 2, null, "large eggs"],
    ["1.5 lbs ground beef", 1.5, "lbs", "ground beef"],
    ["4 slices cheddar cheese", 4, "slices", "cheddar cheese"],
    ["500g chicken thighs", 500, "g", "chicken thighs"],
    ["1 1/2 cups milk", 1.5, "cups", "milk"],
    ["2 T butter", 2, "T", "butter"],
  ])(
    "only treats a known unit as the unit: %s",
    (text, quantity, unit, name) => {
      expect(parseIngredient(text)).toMatchObject({ quantity, unit, name });
    },
  );

  it.each(["1-2 cups flour", "2½ cups milk", "1,5 kg potatoes", "1.5", "1/2"])(
    "keeps %s whole instead of splitting the number",
    (text) => {
      expect(parseIngredient(text)).toMatchObject({
        quantity: null,
        unit: null,
        name: text,
      });
    },
  );

  it.each(["500g", "2 cups", "2 lbs."])(
    "keeps a bare amount (%s) whole",
    (text) => {
      expect(parseIngredient(text)).toMatchObject({
        quantity: null,
        name: text,
      });
    },
  );

  it("parses ingredient lists in order", () => {
    expect(
      parseIngredients(["1 cup flour", "salt"]).map((item) => item.name),
    ).toEqual(["flour", "salt"]);
  });
});

describe("ingredient normalization and display", () => {
  it.each([
    ["Fresh Large Tomatoes", "tomato"],
    ["small potatoes", "potato"],
    ["beans", "beans"],
    ["glass", "glass"],
    ["Sliced Mushrooms", "mushroom"],
  ])("normalizes %s", (name, expected) => {
    expect(normalizeIngredientName(name)).toBe(expected);
  });

  it("removes preparation punctuation without disturbing the name", () => {
    expect(extractPreparation("carrots, thinly sliced")).toEqual({
      name: "carrots",
      preparation: "thinly sliced",
    });
  });

  it.each([
    [null, ""],
    [0, ""],
    [2, "2"],
    [0.5, "0.5"],
    [1.25, "1.25"],
  ] as const)("formats %s as %s", (quantity, expected) => {
    expect(formatQuantity(quantity)).toBe(expected);
  });
});
