import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cacheRecipe,
  getCachedRecipe,
  recipeCacheKey,
} from "../../../src/import/url/cache";
import type { ParsedRecipe } from "../../../src/schema";

function createMockKv() {
  const store = new Map<string, string>();
  return {
    get: vi.fn((key: string, type?: string) => {
      const value = store.get(key);
      if (!value) return Promise.resolve(null);
      return Promise.resolve(type === "json" ? JSON.parse(value) : value);
    }),
    put: vi.fn(
      (key: string, value: string, _options?: { expirationTtl?: number }) => {
        store.set(key, value);
        return Promise.resolve();
      },
    ),
    _store: store,
  };
}

const mockRecipe: ParsedRecipe = {
  name: "Test Recipe",
  description: "A test",
  prepTime: 10,
  cookTime: 20,
  totalTime: 30,
  servings: 4,
  sourceUrl: "https://example.com/Recipes/Pasta?Size=Large",
  ingredientSections: [
    {
      name: null,
      ingredients: [{ index: 0, quantity: 2, unit: "cup", name: "flour" }],
    },
  ],
  instructionSections: [
    {
      name: null,
      instructions: [{ index: 0, instruction: "Mix", imageUrl: null }],
    },
  ],
  images: ["https://example.com/img.jpg"],
  suggestedTags: ["American"],
};

const deterministicOptions = {
  parseMethod: "structured_data" as const,
  strategy: "deterministic" as const,
};

const aiOptions = {
  parseMethod: "ai_only" as const,
  strategy: "ai-assisted" as const,
};

describe("recipe cache v2", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("stores schema, strategy, provenance, parse method and recipe", async () => {
    const kv = createMockKv();
    await cacheRecipe(
      kv as never,
      "https://example.com/Recipes/Pasta?Size=Large",
      mockRecipe,
      deterministicOptions,
    );

    const [key, serialized, options] = kv.put.mock.calls[0]!;
    expect(key).toMatch(/^recipe:v2:deterministic:/);
    expect(JSON.parse(serialized)).toMatchObject({
      schemaVersion: 2,
      parseMethod: "structured_data",
      strategy: "deterministic",
      provenance: "deterministic",
      recipe: mockRecipe,
    });
    expect(options).toEqual({ expirationTtl: 86_400 });
  });

  it("preserves case-sensitive paths and queries while normalising the host", async () => {
    const upperHost = await recipeCacheKey(
      "https://EXAMPLE.com/Recipes/Pasta?Size=Large",
      "deterministic",
    );
    const lowerHost = await recipeCacheKey(
      "https://example.com/Recipes/Pasta?Size=Large",
      "deterministic",
    );
    const lowerPath = await recipeCacheKey(
      "https://example.com/recipes/pasta?size=large",
      "deterministic",
    );

    expect(upperHost).toBe(lowerHost);
    expect(lowerPath).not.toBe(lowerHost);
  });

  it("separates deterministic and AI-assisted namespaces", async () => {
    const deterministic = await recipeCacheKey(
      "https://example.com/recipe",
      "deterministic",
    );
    const assisted = await recipeCacheKey(
      "https://example.com/recipe",
      "ai-assisted",
    );

    expect(deterministic).not.toBe(assisted);
    expect(deterministic).toMatch(/^recipe:v2:deterministic:/);
    expect(assisted).toMatch(/^recipe:v2:ai-assisted:/);
  });

  it("does not let Basic read an AI-assisted entry", async () => {
    const kv = createMockKv();
    const url = "https://example.com/recipe";
    await cacheRecipe(kv as never, url, mockRecipe, aiOptions);

    await expect(
      getCachedRecipe(kv as never, url, "deterministic"),
    ).resolves.toBeNull();
  });

  it("lets Smart prefer AI-assisted and fall back to deterministic", async () => {
    const kv = createMockKv();
    const url = "https://example.com/recipe";
    await cacheRecipe(kv as never, url, mockRecipe, deterministicOptions);

    await expect(
      getCachedRecipe(kv as never, url, "ai-assisted"),
    ).resolves.toMatchObject({
      strategy: "deterministic",
      entry: {
        strategy: "deterministic",
        recipe: mockRecipe,
      },
    });

    const assistedRecipe = { ...mockRecipe, name: "AI Recipe" };
    await cacheRecipe(kv as never, url, assistedRecipe, aiOptions);
    await expect(
      getCachedRecipe(kv as never, url, "ai-assisted"),
    ).resolves.toMatchObject({
      strategy: "ai-assisted",
      entry: { recipe: assistedRecipe },
    });
  });

  it("ignores unversioned legacy values", async () => {
    const kv = createMockKv();
    const key = await recipeCacheKey(
      "https://example.com/recipe",
      "deterministic",
    );
    kv._store.set(key, JSON.stringify(mockRecipe));

    await expect(
      getCachedRecipe(
        kv as never,
        "https://example.com/recipe",
        "deterministic",
      ),
    ).resolves.toBeNull();
  });
});
