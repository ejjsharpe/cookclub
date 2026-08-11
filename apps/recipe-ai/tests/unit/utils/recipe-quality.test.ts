import { describe, expect, it } from "vitest";

import type { ParsedRecipe } from "../../../src/schema";
import {
  evaluateRecipeQuality,
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

  it("replaces social UI titles and strips emoji instruction numbers", () => {
    const normalized = normalizeRecipeForImport({
      ...recipeWithImages(["https://example.com/thumb.jpg"]),
      name: "Follow",
      sourceUrl: "https://www.instagram.com/reel/DFIyUJAo2nL/",
      instructionSections: [
        {
          name: null,
          instructions: [
            { index: 0, instruction: "1️⃣ Preheat the oven." },
            { index: 1, instruction: "② Mix the batter." },
            { index: 2, instruction: "3. Bake until golden." },
            { index: 3, instruction: "2 eggs are enough for this batter." },
          ],
        },
      ],
    });

    expect(normalized.name).toBe("Imported Social Recipe");
    expect(normalized.instructionSections[0]?.instructions).toEqual([
      expect.objectContaining({ instruction: "Preheat the oven." }),
      expect.objectContaining({ instruction: "Mix the batter." }),
      expect.objectContaining({ instruction: "Bake until golden." }),
      expect.objectContaining({
        instruction: "2 eggs are enough for this batter.",
      }),
    ]);
  });

  it("removes generic placeholder instructions", () => {
    const normalized = normalizeRecipeForImport({
      ...recipeWithImages(["https://example.com/thumb.jpg"]),
      instructionSections: [
        {
          name: null,
          instructions: [
            {
              index: 0,
              instruction:
                "Follow the method shown in the source video using the listed ingredients.",
            },
          ],
        },
      ],
    });

    expect(normalized.instructionSections).toEqual([]);
  });
});

describe("evaluateRecipeQuality", () => {
  it("accepts ingredient-only recipes with low confidence", () => {
    const quality = evaluateRecipeQuality(
      {
        ...recipeWithImages(["https://example.com/social.jpg"]),
        name: "Firecracker Ramen",
        sourceUrl: "https://www.instagram.com/reel/DFTA0yKIVPa/",
        servings: 3,
        ingredientSections: [
          {
            name: null,
            ingredients: Array.from({ length: 8 }, (_, index) => ({
              index,
              quantity: index + 1,
              unit: "tbsp",
              name: `ingredient ${index + 1}`,
            })),
          },
        ],
        instructionSections: [],
      },
      "social_ai",
    );

    expect(quality.usable).toBe(true);
    expect(quality.confidence).toBe("low");
    expect(quality.reasons).toContain("missing_instructions");
  });

  it("rejects recipes without ingredients", () => {
    const quality = evaluateRecipeQuality(
      {
        ...recipeWithImages(["https://example.com/social.jpg"]),
        name: "Random Post",
        sourceUrl: "https://www.instagram.com/reel/ABC123/",
        ingredientSections: [],
        instructionSections: [],
      },
      "social_ai",
    );

    expect(quality.usable).toBe(false);
    expect(quality.reasons).toContain("missing_ingredients");
  });

  it("rejects section headings used as recipe titles", () => {
    const quality = evaluateRecipeQuality(
      {
        ...recipeWithImages(["https://example.com/recipe.jpg"]),
        name: "Ingredients",
        ingredientSections: [
          {
            name: null,
            ingredients: Array.from({ length: 8 }, (_, index) => ({
              index,
              quantity: index + 1,
              unit: null,
              name: `ingredient ${index + 1}`,
            })),
          },
        ],
        instructionSections: [
          {
            name: null,
            instructions: Array.from({ length: 8 }, (_, index) => ({
              index,
              instruction: `Complete recipe step ${index + 1}.`,
            })),
          },
        ],
      },
      "structured",
    );

    expect(quality.usable).toBe(false);
    expect(quality.reasons).toContain("section_heading_title");
  });
});
