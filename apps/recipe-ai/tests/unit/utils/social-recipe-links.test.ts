import { describe, expect, it } from "vitest";

import { extractSocialRecipeLinks } from "../../../src/utils/social-recipe-links";

describe("extractSocialRecipeLinks", () => {
  const sourceUrl = "https://www.instagram.com/reel/ABC123/";

  it("extracts direct external recipe links from social text", () => {
    expect(
      extractSocialRecipeLinks(
        [
          "Full recipe: https://www.example.com/tomato-pasta?utm_source=ig.",
          "Mirror at www.example.org/recipes/tomato-pasta!",
          "Also recipe.example.net/chicken",
        ],
        sourceUrl,
      ),
    ).toEqual([
      "https://www.example.com/tomato-pasta",
      "https://www.example.org/recipes/tomato-pasta",
      "https://recipe.example.net/chicken",
    ]);
  });

  it("dedupes and caps links", () => {
    expect(
      extractSocialRecipeLinks(
        [
          "https://example.com/a?utm_medium=social",
          "https://example.com/a",
          "https://example.com/b",
          "https://example.com/c",
        ],
        sourceUrl,
        { maxLinks: 2 },
      ),
    ).toEqual(["https://example.com/a", "https://example.com/b"]);
  });

  it("skips social, self, local, and media URLs", () => {
    expect(
      extractSocialRecipeLinks(
        [
          "https://www.instagram.com/reel/ABC123/",
          "https://cdninstagram.com/image.jpg",
          "https://localhost/recipe",
          "https://images.example.com/food.webp",
          "recipe.example.com",
          "https://recipe.example.com/pasta",
        ],
        sourceUrl,
      ),
    ).toEqual(["https://recipe.example.com/pasta"]);
  });
});
