import { afterEach, describe, expect, it, vi } from "vitest";

import { parseSocialUrl } from "../../../src/import/social";
import { RecipeAI } from "../../../src/index";
import type { Env } from "../../../src/types";
import {
  RECIPE_AI_INFERENCE_CLIENT,
  type AiClient,
} from "../../../src/utils/ai-response-parser";
import {
  chiliRoundup,
  pinterestHtml,
  recipePins,
  sharedPastaPin,
} from "../../fixtures/pinterest";

class TestParser extends RecipeAI {
  constructor(
    env: Env,
    private ai: AiClient,
  ) {
    super({} as ExecutionContext, env);
    this.env = env;
  }
  override [RECIPE_AI_INFERENCE_CLIENT]() {
    return this.ai;
  }
}

// Synthetic recipe content tests the import pipeline, not Allrecipes' recipe accuracy.
const draft = {
  name: "Test flatbread",
  servings: 2,
  prepTime: null,
  cookTime: null,
  totalTime: null,
  ingredientSections: [
    {
      name: null,
      ingredients: [
        { index: 0, name: "flour", quantity: 2, unit: "cup" },
        { index: 1, name: "water", quantity: 1, unit: "cup" },
      ],
    },
  ],
  instructionSections: [
    {
      name: null,
      instructions: [
        {
          index: 0,
          instruction: "Mix flour and water in a bowl, then bake in the oven.",
        },
      ],
    },
  ],
};
function setup() {
  const complete = vi.fn().mockResolvedValue(JSON.stringify(draft));
  const uploadFromUrl = vi.fn(async (_url: string, key: string) => ({
    success: true,
    key,
    publicUrl: `https://images.example.com/${key}`,
  }));
  const env = {
    RECIPE_CACHE: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
    },
    IMAGE_PUBLIC_URL: "https://images.example.com",
    IMAGE_SERVICE: { uploadFromUrl },
  } as unknown as Env;
  return {
    env,
    complete,
    uploadFromUrl,
    parser: new TestParser(env, { complete }),
  };
}
function htmlResponse(html: string) {
  return new Response(html, { headers: { "content-type": "text/html" } });
}
function linkedRecipeHtml(name: string) {
  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Recipe",
    name,
    recipeYield: "2 servings",
    recipeIngredient: ["2 cups flour", "1 cup water"],
    recipeInstructions: [
      {
        "@type": "HowToStep",
        text: draft.instructionSections[0]!.instructions[0]!.instruction,
      },
    ],
    image: "https://images.example.org/recipe.jpg",
  })}</script>`;
}
afterEach(() => vi.unstubAllGlobals());

describe("Pinterest Smart Import", () => {
  it.each([
    sharedPastaPin.shareUrl,
    "https://www.pinterest.co.uk/pin/1085719422756328161/sent/?sfo=1",
  ])("imports the saved recipe shared at %s", async (url) => {
    const { parser, complete, uploadFromUrl } = setup();
    const target = sharedPastaPin.meta["pinterestapp:source"];
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const requested = String(input);
      if (requested === sharedPastaPin.shareUrl)
        return new Response(null, {
          status: 308,
          headers: {
            location:
              "https://api.pinterest.com/url_shortener/6yNaaUV80/redirect/",
          },
        });
      if (
        requested ===
        "https://api.pinterest.com/url_shortener/6yNaaUV80/redirect/"
      )
        return new Response(null, {
          status: 302,
          headers: {
            location:
              "https://www.pinterest.co.uk/pin/1085719422756328161/sent/?sfo=1",
          },
        });
      if (
        requested === "https://www.pinterest.co.uk/pin/1085719422756328161/" ||
        requested === "https://www.pinterest.com/pin/1085719422756328161/"
      )
        return new Response(null, {
          status: 308,
          headers: { location: sharedPastaPin.sourceUrl },
        });
      if (requested === sharedPastaPin.sourceUrl)
        return htmlResponse(pinterestHtml(sharedPastaPin));
      if (requested === target)
        return htmlResponse(linkedRecipeHtml("Marry Me Chicken Pasta"));
      throw new Error(`Unexpected fetch: ${input}`);
    });
    vi.stubGlobal("fetch", fetch);
    expect(
      await parser.parse({ type: "url", data: url, strategy: "ai-assisted" }),
    ).toMatchObject({
      success: true,
      data: { name: "Marry Me Chicken Pasta", sourceUrl: target },
      metadata: {
        parseMethod: "schema_org",
        diagnostics: { originalUrl: url, platform: "pinterest" },
      },
    });
    expect(complete).not.toHaveBeenCalled();
    expect(uploadFromUrl).toHaveBeenCalledTimes(1);
  });

  it.each(recipePins)(
    "imports the recipe linked from $sourceUrl through the existing website pipeline",
    async (fixture) => {
      const { parser, complete, uploadFromUrl } = setup();
      const canonicalPin = fixture.meta["og:url"];
      const target = fixture.meta["pinterestapp:source"].split("?")[0]!;
      const name = fixture.structured[0]!.headline;
      const fetch = vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === canonicalPin)
          return htmlResponse(pinterestHtml(fixture));
        if (String(input) === target)
          return htmlResponse(linkedRecipeHtml(name));
        throw new Error(`Unexpected fetch: ${input}`);
      });
      vi.stubGlobal("fetch", fetch);
      const jobId = "2d4976e7-c19b-46de-b893-dc18013097de";
      const result = await parser.parse({
        type: "url",
        data: fixture.sourceUrl,
        strategy: "ai-assisted",
        imageStagingId: jobId,
      });
      expect(result).toMatchObject({
        success: true,
        data: { name, sourceUrl: target },
        metadata: {
          canonicalUrl: target,
          parseMethod: "schema_org",
          diagnostics: {
            originalUrl: fixture.sourceUrl,
            platform: "pinterest",
          },
        },
      });
      if (!result.success) throw new Error("Expected linked recipe");
      expect(result.data.ingredientSections[0]?.ingredients).toHaveLength(2);
      expect(result.data.instructionSections[0]?.instructions).toHaveLength(1);
      expect(result.data.images?.[0]).toContain(`/imports/${jobId}/`);
      expect(uploadFromUrl).toHaveBeenCalledTimes(1);
      expect(complete).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );

  it("preserves the original short share URL and does not prefetch pin.it separately", async () => {
    const fixture = recipePins[0]!;
    const { parser, complete } = setup();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: fixture.sourceUrl },
        }),
      )
      .mockResolvedValueOnce(htmlResponse(pinterestHtml(fixture)))
      .mockResolvedValueOnce(htmlResponse(linkedRecipeHtml("Pecan pie")));
    vi.stubGlobal("fetch", fetch);
    const result = await parser.parse({
      type: "url",
      data: "https://pin.it/abc123",
      strategy: "ai-assisted",
    });
    expect(result).toMatchObject({
      success: true,
      metadata: {
        diagnostics: {
          originalUrl: "https://pin.it/abc123",
          platform: "pinterest",
        },
      },
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(complete).not.toHaveBeenCalled();
  });

  it("uses the same social AI and image flow for a written recipe without a source link", async () => {
    const { parser, complete, uploadFromUrl } = setup();
    const url = "https://www.pinterest.com/pin/123/";
    const description =
      "Ingredients:\n- 2 cups flour\n- 1 cup water\nDirections:\nMix flour and water in a bowl, then bake in the oven.";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        htmlResponse(
          pinterestHtml({
            meta: {
              "og:url": url,
              "og:title": draft.name,
              "og:description": description,
              "og:image": "https://i.pinimg.com/originals/bread.jpg",
            },
          }),
        ),
      ),
    );
    const result = await parser.parse({
      type: "url",
      data: url,
      strategy: "ai-assisted",
    });
    expect(result).toMatchObject({
      success: true,
      data: { name: draft.name, sourceUrl: url },
      metadata: { diagnostics: { selectedAttempt: "pinterest_description" } },
    });
    expect(JSON.stringify(complete.mock.calls)).toContain("2 cups flour");
    expect(uploadFromUrl).toHaveBeenCalledTimes(1);
  });

  it("does not use unrelated recipes when a pin exposes only a promotional preview", async () => {
    const { parser, complete } = setup();
    const url = "https://www.pinterest.com/pin/123/";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        htmlResponse(
          pinterestHtml({
            meta: {
              "og:url": url,
              "og:title": "Amazing dinner",
              "og:description": "Save this delicious dinner for later!",
            },
            payload: {
              id: "999",
              type: "pin",
              description: "2 cups flour and 1 cup water",
              link: "https://wrong.example/recipe",
            },
          }) + '<a href="https://wrong.example/cake">Related recipe</a>',
        ),
      ),
    );
    expect(
      await parser.parse({ type: "url", data: url, strategy: "ai-assisted" }),
    ).toMatchObject({
      success: false,
      error: { code: "IMPORT_RECIPE_NOT_FOUND", disposition: "terminal" },
    });
    expect(complete).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    "https://uk.pinterest.com/allrecipes/",
    "https://www.pinterest.com/allrecipes/dinner-ideas/",
  ])("rejects the profile or board %s before fetching", async (url) => {
    const { parser } = setup();
    vi.stubGlobal("fetch", vi.fn());
    expect(
      await parser.parse({ type: "url", data: url, strategy: "ai-assisted" }),
    ).toMatchObject({
      success: false,
      error: { code: "IMPORT_UNSUPPORTED_SOURCE", disposition: "terminal" },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["https://pin.it/abc123", "https://uk.pinterest.com/pin/123/"])(
    "routes %s to Smart Import without fetching in Basic Import",
    async (url) => {
      const { parser } = setup();
      vi.stubGlobal("fetch", vi.fn());
      expect(
        await parser.parse({
          type: "url",
          data: url,
          strategy: "deterministic",
        }),
      ).toMatchObject({
        success: false,
        error: { code: "IMPORT_UNSUPPORTED_SOURCE" },
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([403, 404, 410])(
    "makes unavailable pins terminal (%s)",
    async (status) => {
      const { parser } = setup();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response("Unavailable", { status })),
      );
      expect(
        await parser.parse({
          type: "url",
          data: recipePins[0]!.sourceUrl,
          strategy: "ai-assisted",
        }),
      ).toMatchObject({
        success: false,
        error: { code: "IMPORT_SOURCE_UNAVAILABLE", disposition: "terminal" },
      });
    },
  );

  it("preserves Pinterest's retry-after on rate limiting", async () => {
    const { parser } = setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("Busy", {
          status: 429,
          headers: { "retry-after": "20" },
        }),
      ),
    );
    expect(
      await parser.parse({
        type: "url",
        data: recipePins[0]!.sourceUrl,
        strategy: "ai-assisted",
      }),
    ).toMatchObject({
      success: false,
      error: {
        code: "IMPORT_SOURCE_UNAVAILABLE",
        disposition: "retry",
        retryAfterSeconds: 20,
      },
    });
  });

  it("maps timeouts to the existing retryable import timeout", async () => {
    const { parser } = setup();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(
          new DOMException("The operation timed out", "TimeoutError"),
        ),
    );
    expect(
      await parser.parse({
        type: "url",
        data: recipePins[0]!.sourceUrl,
        strategy: "ai-assisted",
      }),
    ).toMatchObject({
      success: false,
      error: { code: "IMPORT_TIMED_OUT", disposition: "retry" },
    });
  });

  it.each([
    { code: "NO_RECIPE", disposition: "terminal" },
    { code: "FETCH_FAILED", disposition: "retry", retryAfterSeconds: 20 },
  ])(
    "preserves linked-page failure $code without inventing a recipe from the roundup preview",
    async (error) => {
      const { env, complete } = setup();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(htmlResponse(pinterestHtml(chiliRoundup))),
      );
      const parseLinkedRecipeUrl = vi.fn().mockResolvedValue({
        success: false,
        error: { ...error, message: "No recipe available" },
        metadata: { source: "url", confidence: "low" },
      });
      const result = await parseSocialUrl(
        env,
        chiliRoundup.sourceUrl,
        "pinterest",
        {
          aiClient: { complete },
          parseLinkedRecipeUrl,
          diagnostics: { originalUrl: chiliRoundup.sourceUrl },
        },
      );
      expect(result).toMatchObject({
        success: false,
        error,
        metadata: { diagnostics: { originalUrl: chiliRoundup.sourceUrl } },
      });
      expect(parseLinkedRecipeUrl).toHaveBeenCalledTimes(1);
      expect(complete).not.toHaveBeenCalled();
    },
  );
});
