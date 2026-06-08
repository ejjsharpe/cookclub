import { describe, expect, it } from "vitest";

import { parseIngredientText } from "../../../src/utils/ingredient-parser";

describe("ingredient parser", () => {
  it("captures tablespoon quantities without converting them", () => {
    expect(parseIngredientText("2 tbsp olive oil")).toEqual({
      quantity: 2,
      unit: "tablespoon",
      name: "olive oil",
    });
  });

  it("captures teaspoon quantities without converting them", () => {
    expect(parseIngredientText("1 tsp salt")).toEqual({
      quantity: 1,
      unit: "teaspoon",
      name: "salt",
    });
  });

  it("captures spelled-out cooking spoon units as canonical units", () => {
    expect(parseIngredientText("3 tablespoons honey")).toEqual({
      quantity: 3,
      unit: "tablespoon",
      name: "honey",
    });
    expect(parseIngredientText("1/2 teaspoon vanilla extract")).toEqual({
      quantity: 0.5,
      unit: "teaspoon",
      name: "vanilla extract",
    });
  });
});
