import { describe, expect, it } from "vitest";

import {
  convertIngredientText,
  convertMethodText,
  convertParsedIngredient,
  detectSystemFromIngredients,
} from "./measurementUtils";

describe("measurement utilities", () => {
  describe("cooking spoon units", () => {
    it("preserves abbreviated tsp and tbsp when converting parsed ingredients to metric", () => {
      expect(convertParsedIngredient(2, "tbsp", "metric", "olive oil")).toBe(
        null,
      );
      expect(convertParsedIngredient(1, "tsp", "metric", "salt")).toBe(null);
    });

    it("preserves spelled-out teaspoon and tablespoon units", () => {
      expect(convertParsedIngredient(1, "tablespoon", "metric", "honey")).toBe(
        null,
      );
      expect(convertParsedIngredient(0.5, "teaspoon", "metric", "salt")).toBe(
        null,
      );
    });

    it("preserves tsp and tbsp in free-text ingredients and method text", () => {
      expect(convertIngredientText("1 tsp salt", "metric")).toBe("1 tsp salt");
      expect(convertIngredientText("2 tbsp olive oil", "metric")).toBe(
        "2 tbsp olive oil",
      );
      expect(
        convertMethodText("Stir in 1 tsp vanilla and 2 tbsp oil.", "metric"),
      ).toBe("Stir in 1 tsp vanilla and 2 tbsp oil.");
    });

    it("ignores tsp and tbsp when detecting the source measurement system", () => {
      expect(detectSystemFromIngredients(["1 tsp salt", "200 g flour"])).toBe(
        "metric",
      );
    });
  });

  describe("other conversions", () => {
    it("still converts imperial volume ingredients to metric with density", () => {
      expect(convertParsedIngredient(1, "cup", "metric", "flour")).toEqual({
        quantity: 125,
        unit: "g",
      });
    });

    it("still allows small metric volumes to convert into tsp for imperial display", () => {
      expect(convertParsedIngredient(5, "ml", "imperial", "water")).toEqual({
        quantity: 1.01,
        unit: "tsp",
      });
    });
  });
});
