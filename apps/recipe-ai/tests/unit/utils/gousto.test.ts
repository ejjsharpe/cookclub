import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { collectGoustoRecipeCandidates } from "../../../src/import/url/gousto";
import { evaluateRecipeCandidates } from "../../../src/import/url/parse";
import { goustoApiUrl, goustoResponse, goustoUrl } from "../../fixtures/gousto";

describe("Gousto cookbook import", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(goustoResponse)),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("imports usable recipe data, quantities, ordered steps, images and per-serving nutrition", async () => {
    const candidates = await collectGoustoRecipeCandidates(goustoUrl);
    const recipe = candidates[0]?.recipe;

    expect(fetch).toHaveBeenCalledWith(goustoApiUrl, {
      signal: expect.any(AbortSignal),
      redirect: "manual",
      headers: {
        Accept: "application/json",
        "x-gousto-request-source": "content-webclient",
      },
    });
    expect(evaluateRecipeCandidates(candidates).accepted).toHaveLength(1);
    expect(recipe).toMatchObject({
      name: goustoResponse.data.entry.title,
      sourceUrl: goustoUrl,
      servings: 2,
      totalTime: 50,
      ingredientSections: [
        {
          name: null,
          ingredients: [
            { index: 0, name: "Pork & beef mince", quantity: 250, unit: "g" },
            { index: 1, name: "Fresh tagliatelle", quantity: 250, unit: "g" },
            {
              index: 2,
              name: "Intense beef stock mix",
              quantity: 5.5,
              unit: "g",
            },
            { index: 3, name: "Garlic clove", quantity: 3, unit: null },
            { index: 4, name: "Dried bay leaf", quantity: 1, unit: null },
            { index: 5, name: "Balsamic vinegar", quantity: 15, unit: "ml" },
          ],
        },
        {
          name: "Pantry items",
          ingredients: [
            { name: "Butter", quantity: null },
            { name: "Flour", quantity: null },
            { name: "Water", quantity: null },
          ],
        },
      ],
      instructionSections: [
        {
          instructions: [
            {
              index: 0,
              instruction:
                "Mix the yeast with 100ml warm water. Set aside for 5 minutes.",
              imageUrl: "https://production-media.gousto.co.uk/step-1-x700.jpg",
            },
            {
              index: 1,
              instruction: "Brown the mince & garlic, then simmer the sauce.",
              imageUrl: null,
            },
          ],
        },
      ],
      images: ["https://production-media.gousto.co.uk/ragu-x1500.jpg"],
      suggestedTags: ["Italian"],
      nutrition: {
        calories: 1319,
        protein: 60.545,
        fat: 43.201,
        source: "extracted",
      },
    });
  });

  it("handles pack multipliers and sorts instructions by their published order", async () => {
    const response = structuredClone(goustoResponse);
    response.data.entry.ingredients = [
      { label: "Chopped tomatoes (200g) x2" },
      { label: "Garlic clove x0" },
    ];
    response.data.entry.cooking_instructions.reverse();
    vi.mocked(fetch).mockResolvedValue(Response.json(response));

    const [candidate] = await collectGoustoRecipeCandidates(goustoUrl);
    expect(candidate?.recipe?.ingredientSections[0]?.ingredients).toEqual([
      { index: 0, name: "Chopped tomatoes", quantity: 400, unit: "g" },
    ]);
    expect(
      candidate?.recipe?.instructionSections[0]?.instructions[0]?.instruction,
    ).toContain("Mix the yeast");
  });

  it.each([
    goustoUrl.replace("www.gousto.co.uk", "gousto.co.uk"),
    goustoUrl.replace("/recipes/", "/italian-recipes/"),
    `${goustoUrl}/?utm_source=share`,
  ])("accepts cookbook URL variants: %s", async (url) => {
    const [candidate] = await collectGoustoRecipeCandidates(url);
    expect(candidate?.recipe?.sourceUrl).toBe(url);
    expect(fetch).toHaveBeenCalledWith(goustoApiUrl, expect.any(Object));
  });

  it.each([
    "https://example.com/cookbook/recipes/soup",
    "https://www.gousto.co.uk.evil.example/cookbook/recipes/soup",
    "https://www.gousto.co.uk/cookbook/recipes",
    "https://www.gousto.co.uk/cookbook/recipes/soup/extra",
    "https://www.gousto.co.uk/cookbook/recipes/%2fprivate",
  ])(
    "does not call the API for unrelated or invalid recipe URLs: %s",
    async (url) => {
      expect(await collectGoustoRecipeCandidates(url)).toEqual([]);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    { status: "ok", data: { entry: {} } },
    {
      status: "ok",
      data: { entry: { ...goustoResponse.data.entry, ingredients: [] } },
    },
    {
      status: "ok",
      data: { entry: { ...goustoResponse.data.entry, url: "/another-recipe" } },
    },
  ])("rejects missing, invalid or mismatched API data", async (response) => {
    vi.mocked(fetch).mockResolvedValue(Response.json(response));
    const [candidate] = await collectGoustoRecipeCandidates(goustoUrl);
    expect(candidate?.recipe).toBeNull();
    expect(candidate?.error).toBeInstanceOf(Error);
  });

  it.each([404, 429, 500])(
    "preserves an API HTTP %s error for fallback diagnostics",
    async (status) => {
      vi.mocked(fetch).mockResolvedValue(new Response(null, { status }));
      const [candidate] = await collectGoustoRecipeCandidates(goustoUrl);
      expect(candidate?.error).toEqual(
        new Error(`Gousto recipe request failed: ${status}`),
      );
    },
  );

  it("preserves network failures for fallback diagnostics", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Request timed out"));
    const [candidate] = await collectGoustoRecipeCandidates(goustoUrl);
    expect(candidate?.recipe).toBeNull();
    expect(candidate?.error).toEqual(new Error("Request timed out"));
  });

  it("rejects oversized API responses", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(" ".repeat(512 * 1024 + 1)),
    );
    const [candidate] = await collectGoustoRecipeCandidates(goustoUrl);
    expect(candidate?.recipe).toBeNull();
    expect(candidate?.error).toEqual(
      expect.objectContaining({
        message: expect.stringContaining("too large"),
      }),
    );
  });
});
