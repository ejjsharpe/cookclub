import { describe, expect, it } from "vitest";

import { DEFAULT_RECIPE_SEARCH_FILTERS } from "./recipeSearchFilters";
import {
  matchingTags,
  searchChips,
  searchTokens,
  withoutLastToken,
} from "./searchTokens";

const TAGS = [
  { id: 1, name: "Indian", recipeCount: 9 },
  { id: 2, name: "Thai", recipeCount: 6 },
  { id: 3, name: "Quick dinners", recipeCount: 18 },
  { id: 4, name: "Empty", recipeCount: 0 },
];

describe("searchTokens", () => {
  it("reads time, source, then tags", () => {
    const filters = {
      ...DEFAULT_RECIPE_SEARCH_FILTERS,
      tagIds: [2],
      maxTotalTime: 30,
      source: "cook" as const,
    };
    expect(searchTokens(filters, TAGS).map((token) => token.label)).toEqual([
      "Under 30 min",
      "From cooks",
      "Thai",
    ]);
  });

  it("takes off the last token on backspace", () => {
    const filters = {
      ...DEFAULT_RECIPE_SEARCH_FILTERS,
      tagIds: [1, 2],
      maxTotalTime: 30,
    };
    const once = withoutLastToken(filters, TAGS);
    expect(once.tagIds).toEqual([1]);
    const twice = withoutLastToken(withoutLastToken(once, TAGS), TAGS);
    expect(twice).toEqual(DEFAULT_RECIPE_SEARCH_FILTERS);
    expect(withoutLastToken(twice, TAGS)).toBe(twice);
  });
});

describe("searchChips", () => {
  it("offers a time limit, then the biggest unused tags", () => {
    const chips = searchChips(DEFAULT_RECIPE_SEARCH_FILTERS, TAGS);
    expect(chips.map((chip) => chip.label)).toEqual([
      "Under 30 min",
      "Quick dinners",
      "Indian",
      "Thai",
    ]);
    const applied = chips[1]!.apply(DEFAULT_RECIPE_SEARCH_FILTERS);
    expect(applied.tagIds).toEqual([3]);
  });

  it("skips what's already applied", () => {
    const filters = {
      ...DEFAULT_RECIPE_SEARCH_FILTERS,
      maxTotalTime: 15,
      tagIds: [3],
    };
    expect(searchChips(filters, TAGS).map((chip) => chip.label)).toEqual([
      "Indian",
      "Thai",
    ]);
  });
});

describe("matchingTags", () => {
  it("matches the start of any word", () => {
    expect(matchingTags("din", TAGS, []).map((tag) => tag.name)).toEqual([
      "Quick dinners",
    ]);
    expect(matchingTags("ai", TAGS, [])).toEqual([]);
    expect(matchingTags("t", TAGS, [2])).toEqual([]);
    expect(matchingTags("  ", TAGS, [])).toEqual([]);
  });
});
