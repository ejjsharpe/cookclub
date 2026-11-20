import type { RecipeMetadata } from "@repo/contracts/feed";
import { describe, expect, it } from "vitest";

import {
  formatFeedRecipeDetails,
  formatFeedRecipeMeta,
} from "./feedRecipeMeta";

const base = { id: 1, ownerId: "o", name: "Pad thai", image: null };

describe("formatFeedRecipeMeta", () => {
  it("joins source, time and tags", () => {
    const recipe: RecipeMetadata = {
      ...base,
      sourceType: "url",
      sourceUrl: "https://www.seriouseats.com/pad-thai",
      sourceDomain: "seriouseats.com",
      totalTime: 25,
      tags: ["Noodles", "Thai"],
    };
    expect(formatFeedRecipeMeta(recipe)).toBe(
      "seriouseats.com · 25 min · Noodles, Thai",
    );
  });

  it("names the cook for recipes saved from another user", () => {
    const recipe: RecipeMetadata = {
      ...base,
      sourceType: "user",
      originalOwner: { id: "u", name: "Sam", username: "sam", image: null },
      totalTime: 90,
    };
    expect(formatFeedRecipeMeta(recipe)).toBe("@sam · 1 hr 30 min");
  });

  it("is empty when there is nothing to say", () => {
    const recipe: RecipeMetadata = { ...base, sourceType: "manual" };
    expect(formatFeedRecipeMeta(recipe)).toBe("");
  });
});

describe("formatFeedRecipeDetails", () => {
  it("leaves the source out", () => {
    const recipe: RecipeMetadata = {
      ...base,
      sourceType: "url",
      sourceUrl: "https://www.seriouseats.com/pad-thai",
      sourceDomain: "seriouseats.com",
      totalTime: 25,
      tags: ["Noodles", "Thai"],
    };
    expect(formatFeedRecipeDetails(recipe)).toBe("25 min · Noodles, Thai");
  });
});
