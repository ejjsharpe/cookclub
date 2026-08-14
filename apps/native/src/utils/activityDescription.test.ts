import type { RecipeMetadata } from "@repo/contracts/feed";
import { describe, expect, it } from "vitest";

import { formatRecipeImportActivityDescription } from "./activityDescription";

const baseRecipe = {
  id: 1,
  ownerId: "owner",
  name: "Test recipe",
  image: null,
};

describe("formatRecipeImportActivityDescription", () => {
  it.each([
    [{ ...baseRecipe, sourceType: "manual" }, "created a recipe from scratch"],
    [{ ...baseRecipe, sourceType: "ai" }, "created a recipe with AI"],
    [{ ...baseRecipe, sourceType: "text" }, "imported a recipe from text"],
    [{ ...baseRecipe, sourceType: "image" }, "imported a recipe from an image"],
    [
      {
        ...baseRecipe,
        sourceType: "url",
        sourceUrl: "https://example.com/recipe",
        sourceDomain: "example.com",
      },
      "imported a recipe from example.com",
    ],
    [
      {
        ...baseRecipe,
        sourceType: "user",
        originalOwner: {
          id: "source-owner",
          name: "Jamie Oliver",
          username: "jamie",
        },
      },
      "imported a recipe from @jamie",
    ],
    [
      {
        ...baseRecipe,
        sourceType: "user",
        originalOwner: {
          id: "source-owner",
          name: "Jamie Oliver",
          username: null,
        },
      },
      "imported a recipe from Jamie Oliver",
    ],
    [
      { ...baseRecipe, sourceType: "user", originalOwner: null },
      "imported a recipe from another user",
    ],
  ] satisfies [RecipeMetadata, string][])(
    'formats "%s" as "%s"',
    (recipe, expected) => {
      expect(formatRecipeImportActivityDescription(recipe)).toBe(expected);
    },
  );
});
