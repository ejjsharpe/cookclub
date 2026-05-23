import { describe, expect, it } from "vitest";

import type { ParsedRecipe } from "../../../src/schema";
import {
  MAX_RECIPE_IMAGES,
  normalizeRecipeForImport,
} from "../../../src/utils/recipe-quality";

function recipeWithImages(images: string[]): ParsedRecipe {
  return {
    name: "Chocolate Chip Cookies",
    description: null,
    sourceUrl: "https://example.com/cookies",
    sourceType: "url",
    ingredientSections: [
      {
        name: null,
        ingredients: [{ index: 0, quantity: 1, unit: "cup", name: "flour" }],
      },
    ],
    instructionSections: [
      {
        name: null,
        instructions: [{ index: 0, instruction: "Bake the cookies." }],
      },
    ],
    images,
    suggestedTags: [],
  };
}

describe("normalizeRecipeForImport", () => {
  it("deduplicates, filters, and caps recipe images", () => {
    const normalized = normalizeRecipeForImport(
      recipeWithImages([
        "https://example.com/one-225x225.jpg",
        "https://example.com/one-260x195.jpg",
        "https://example.com/one.jpg",
        "https://example.com/two-300x450.jpg",
        "https://example.com/two-1024x1536.jpg",
        "data:image/png;base64,abc",
        "https://example.com/three.jpg",
        "https://example.com/four.jpg",
        "https://example.com/five.jpg",
        "https://example.com/six.jpg",
        "https://example.com/seven.jpg",
        "https://example.com/eight.jpg",
        "https://example.com/nine.jpg",
      ]),
    );

    expect(normalized.images).toHaveLength(MAX_RECIPE_IMAGES);
    expect(normalized.images).toEqual([
      "https://example.com/one.jpg",
      "https://example.com/two-1024x1536.jpg",
      "https://example.com/three.jpg",
      "https://example.com/four.jpg",
      "https://example.com/five.jpg",
      "https://example.com/six.jpg",
    ]);
  });
});
