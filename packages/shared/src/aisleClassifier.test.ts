import { describe, expect, it } from "vitest";

import {
  AISLES,
  classifyIngredientAisle,
  getAisleOrder,
} from "./aisleClassifier";

describe("aisle classification", () => {
  it("uses exact compound matches before individual words", () => {
    expect(classifyIngredientAisle("coconut milk")).toBe("Tinned & Canned");
  });

  it("normalizes case, spacing, and punctuation", () => {
    expect(classifyIngredientAisle("  RED   ONION! ")).toBe("Fresh Produce");
  });

  it("finds known ingredients within a descriptive name", () => {
    expect(classifyIngredientAisle("boneless chicken thighs")).toBe(
      "Meat & Seafood",
    );
  });

  it("falls back safely for empty and unknown ingredients", () => {
    expect(classifyIngredientAisle("")).toBe("Other");
    expect(classifyIngredientAisle("mystery powder xyz")).toBe("Other");
  });

  it("orders every aisle consistently", () => {
    expect(AISLES.map(getAisleOrder)).toEqual(AISLES.map((_, index) => index));
  });
});
