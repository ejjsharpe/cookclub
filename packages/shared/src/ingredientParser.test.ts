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
