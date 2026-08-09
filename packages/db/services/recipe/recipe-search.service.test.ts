import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";

import * as schema from "../../schemas";
import { ServiceError } from "../errors";
import {
  normalizeIngredientSearchQuery,
  normalizeRecipeSearchInput,
  normalizeRecipeSearchQuery,
  normalizeRecipeTitleForSearch,
} from "./recipe-search-input";
import {
  buildRecipeSearchQuery,
  decodeRecipeSearchCursor,
  encodeRecipeSearchCursor,
  searchUserRecipes,
} from "./recipe-search.service";

describe("recipe search normalization", () => {
  it("normalizes whitespace without changing searchable words", () => {
    expect(normalizeRecipeSearchQuery("  Tomato   PASTA  ")).toBe(
      "Tomato PASTA",
    );
  });

  it("normalizes title case and punctuation", () => {
    expect(normalizeRecipeTitleForSearch("  Tomato, PASTA! ")).toBe(
      "tomato pasta",
    );
  });

  it.each([
    ["2 cups tomatoes", "tomatoes"],
    ["1 1/2 tbsp olive oil", "olive oil"],
    ["1 T sugar", "sugar"],
    ["1 t salt", "salt"],
    ["½ teaspoon salt", "salt"],
    ["250 g flour", "flour"],
    ["chicken stock", "chicken stock"],
  ])("removes only a leading quantity and unit from %s", (query, expected) => {
    expect(normalizeIngredientSearchQuery(query)).toBe(expected);
  });

  it("normalizes filters into a stable search input", () => {
    expect(
      normalizeRecipeSearchInput({
        query: "  2 cups   Tomatoes ",
        tagIds: [9.8, -1, 3, 9, 0, 3],
        maxTotalTime: 30.9,
        limit: 500,
      }),
    ).toEqual({
      query: "2 cups Tomatoes",
      ingredientQuery: "Tomatoes",
      tagIds: [3, 9],
      maxTotalTime: 30,
      limit: 100,
    });
  });

  it("normalizes non-finite and negative optional time filters", () => {
    expect(
      normalizeRecipeSearchInput({ query: "eggs", maxTotalTime: Infinity }),
    ).toMatchObject({ maxTotalTime: null });
    expect(
      normalizeRecipeSearchInput({ query: "eggs", maxTotalTime: -5 }),
    ).toMatchObject({ maxTotalTime: 0 });
  });
});

describe("recipe search cursor", () => {
  it("round-trips the complete versioned ordering tuple", () => {
    const cursor = encodeRecipeSearchCursor({
      v: 1,
      fingerprint: "filter-fingerprint",
      exactTitle: true,
      titleMatch: false,
      rank: 0.125,
      createdAt: "2026-07-18T12:00:00.000Z",
      recipeId: 42,
    });

    expect(decodeRecipeSearchCursor(cursor)).toEqual({
      v: 1,
      fingerprint: "filter-fingerprint",
      exactTitle: true,
      titleMatch: false,
      rank: 0.125,
      createdAt: "2026-07-18T12:00:00.000Z",
      recipeId: 42,
    });
    expect(cursor).not.toContain("{");
  });

  it.each(["not-json", "eyJ2IjoyfQ", "$$$"])(
    "rejects malformed cursor %s",
    (cursor) => {
      expect(() => decodeRecipeSearchCursor(cursor)).toThrow(ServiceError);
    },
  );
});

describe("recipe search validation", () => {
  it.each(["", "a", "x".repeat(101)])("rejects query %s", async (query) => {
    await expect(
      searchUserRecipes({} as never, { ownerId: "owner", query }),
    ).rejects.toBeInstanceOf(ServiceError);
  });

  it.each([0, 11])("rejects %i searchable lexemes", async (lexemeCount) => {
    const db = {
      execute: async () => ({ rows: [{ lexeme_count: lexemeCount }] }),
    };

    await expect(
      searchUserRecipes(db as never, {
        ownerId: "owner",
        query:
          lexemeCount === 0
            ? "the"
            : "one two three four five six seven eight nine ten eleven",
      }),
    ).rejects.toBeInstanceOf(ServiceError);
  });

  it("rejects a cursor created for another query or filter set", async () => {
    const db = {
      execute: async () => ({ rows: [{ lexeme_count: 1 }] }),
    };
    const cursor = encodeRecipeSearchCursor({
      v: 1,
      fingerprint: "another-search",
      exactTitle: false,
      titleMatch: false,
      rank: 0.1,
      createdAt: "2026-07-18T12:00:00.000Z",
      recipeId: 1,
    });

    await expect(
      searchUserRecipes(db as never, {
        ownerId: "owner",
        query: "tomato",
        cursor,
      }),
    ).rejects.toBeInstanceOf(ServiceError);
  });
});

describe("recipe search query", () => {
  it("keeps ranking, filters, and cursor pagination in the SQL query", () => {
    const db = drizzle.mock({ schema });
    const { sql, params } = buildRecipeSearchQuery(db, {
      ownerId: "owner-1",
      query: "tomato pasta",
      ingredientQuery: "tomato pasta",
      tagIds: [4, 9],
      maxTotalTime: 30,
      limit: 20,
      cursor: {
        v: 1,
        fingerprint: "fingerprint",
        exactTitle: false,
        titleMatch: true,
        rank: 0.25,
        createdAt: "2026-07-18T12:00:00.000Z",
        recipeId: 42,
      },
    }).toSQL();

    expect(sql).toContain("recipe_prefix_tsquery");
    expect(sql).toContain("recipe_normalize_search_text");
    expect(sql).toContain("matching_recipe_tag");
    expect(sql).toContain('"recipes"."total_time" <=');
    expect(sql).toMatch(/\) < \(/);
    expect(sql).toContain("order by");
    expect(sql).toContain("desc");
    expect(params).toEqual(
      expect.arrayContaining([
        "owner-1",
        "tomato pasta",
        4,
        9,
        30,
        false,
        true,
        0.25,
        42,
        21,
      ]),
    );
  });
});
