import { describe, expect, it } from "vitest";

import { transformParsedRecipeForPreview } from "./recipeTransform";

describe("recipe import transforms", () => {
  const ingredientsOnlyRecipe = {
    success: true,
    data: {
      name: "Tomato Pasta",
      description: null,
      prepTime: null,
      cookTime: null,
      totalTime: null,
      servings: 2,
      sourceUrl: "https://example.com/tomato-pasta",
      sourceType: "url",
      images: ["https://images.example.com/tomato-pasta.jpg"],
      ingredientSections: [
        {
          name: null,
          ingredients: [
            { index: 0, quantity: 200, unit: "g", name: "spaghetti" },
            { index: 1, quantity: 1, unit: "cup", name: "tomato sauce" },
          ],
        },
      ],
      instructionSections: [],
      suggestedTags: [],
    },
    metadata: {
      source: "url",
      parseMethod: "ai_only",
      confidence: "low",
    },
  } as const;

  it("allows ingredients-only imports to be previewed", () => {
    expect(
      transformParsedRecipeForPreview(ingredientsOnlyRecipe as any)
        ?.instructionSections,
    ).toEqual([{ id: -1, name: null, index: 0, instructions: [] }]);
  });
});
