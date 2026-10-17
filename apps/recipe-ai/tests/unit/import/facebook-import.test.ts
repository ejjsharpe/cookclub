import { afterEach, describe, expect, it, vi } from "vitest";

import { parseSocialUrl } from "../../../src/import/social";
import { RecipeAI } from "../../../src/index";
import type { Env } from "../../../src/types";
import {
  RECIPE_AI_INFERENCE_CLIENT,
  type AiClient,
} from "../../../src/utils/ai-response-parser";
import {
  accordionPotatoes,
  facebookHtml,
  tomatoSoup,
  tomatoSoupRecipe,
  wheatThins,
  wheatThinsRecipe,
} from "../../fixtures/facebook";

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

function setup(recipe: unknown = wheatThinsRecipe) {
  const complete = vi.fn().mockResolvedValue(JSON.stringify(recipe));
  const uploadFromUrl = vi.fn(async (_url: string, key: string) => ({
    success: true,
    key,
    publicUrl: `https://images.example.com/${key}`,
  }));
  const env = {
    GROQ_API_KEY: "test",
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

afterEach(() => vi.unstubAllGlobals());

describe("Facebook Smart Import", () => {
  it("maps Facebook timeouts to a retryable import timeout", async () => {
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
        data: wheatThins.sourceUrl,
        strategy: "ai-assisted",
      }),
    ).toMatchObject({
      success: false,
      error: { code: "IMPORT_TIMED_OUT", disposition: "retry" },
    });
  });

  it("retains an incomplete written draft when optional media cannot be read", async () => {
    const partial = { ...wheatThinsRecipe, instructionSections: [] };
    const { parser } = setup(partial);
    const html = facebookHtml({
      meta: { "og:url": "https://www.facebook.com/reel/123/" },
      payload: {
        id: "123",
        message: {
          text: "Ingredients:\n- whole wheat flour\n- water\nInstructions in comments",
        },
        captions_url: "https://scontent.xx.fbcdn.net/missing.srt",
      },
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(htmlResponse(html))
        .mockResolvedValueOnce(new Response("Gone", { status: 404 })),
    );
    expect(
      await parser.parse({
        type: "url",
        data: "https://www.facebook.com/reel/123/",
        strategy: "ai-assisted",
      }),
    ).toMatchObject({
      success: true,
      data: { instructionSections: [] },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("imports wheat thins from public subtitles, preserving gaps and staging its cover", async () => {
    const { parser, complete, uploadFromUrl } = setup();
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === wheatThins.sourceUrl)
        return htmlResponse(facebookHtml(wheatThins));
      if (url.endsWith("captions.srt"))
        return new Response(wheatThins.subtitles, {
          headers: { "content-type": "text/srt" },
        });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetch);
    const jobId = "2d4976e7-c19b-46de-b893-dc18013097de";
    const result = await parser.parse({
      type: "url",
      data: wheatThins.sourceUrl,
      strategy: "ai-assisted",
      imageStagingId: jobId,
    });
    expect(result).toMatchObject({
      success: true,
      data: { name: "Homemade Wheat Thins", cookTime: null },
    });
    expect(result.metadata).not.toHaveProperty("warnings");
    if (!result.success) throw new Error("Expected a recipe draft");
    expect(result.data.ingredientSections[0]?.ingredients).toHaveLength(6);
    expect(
      result.data.ingredientSections[0]?.ingredients.every(
        (ingredient) => ingredient.quantity == null,
      ),
    ).toBe(true);
    expect(
      result.data.instructionSections[0]?.instructions[2]?.instruction,
    ).toBe("Sprinkle with salt and bake.");
    expect(result.data.images?.[0]).toContain(`/imports/${jobId}/`);
    expect(result.metadata.diagnostics?.originalUrl).toBe(wheatThins.sourceUrl);
    expect(uploadFromUrl).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(complete.mock.calls)).toContain("whole wheat flour");
    expect(JSON.stringify(complete.mock.calls)).toContain(
      "Do not invent missing quantities",
    );
  });

  it("imports both soup and grilled cheese sections from the share link without reading music", async () => {
    const { parser, complete } = setup(tomatoSoupRecipe);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: tomatoSoup.meta["og:url"] },
        }),
      )
      .mockResolvedValueOnce(htmlResponse(facebookHtml(tomatoSoup)));
    vi.stubGlobal("fetch", fetch);
    const result = await parser.parse({
      type: "url",
      data: tomatoSoup.sourceUrl,
      strategy: "ai-assisted",
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected soup recipe");
    expect(
      result.data.ingredientSections.map((section) => section.name),
    ).toEqual(["Soup", "Grilled cheese"]);
    expect(
      result.data.ingredientSections.flatMap((section) => section.ingredients),
    ).toHaveLength(14);
    expect(result.data.instructionSections).toHaveLength(2);
    expect(
      result.data.instructionSections[0]?.instructions[2]?.instruction,
    ).toContain("350°F (180°C) for 40–50 minutes");
    expect(
      result.data.instructionSections[0]?.instructions[4]?.instruction,
    ).toContain("1–2 cups (240–480 ml)");
    expect(result.metadata.diagnostics?.originalUrl).toBe(tomatoSoup.sourceUrl);
    expect(result.data.sourceUrl).toBe(tomatoSoup.meta["og:url"]);
    const evidence = JSON.stringify(complete.mock.calls);
    expect(evidence).toContain("How to make the grilled cheese:");
    expect(evidence).not.toContain("song lyrics");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("uses the potato reel's audio when subtitles are absent (synthetic narration)", async () => {
    const potatoRecipe = {
      ...wheatThinsRecipe,
      name: "Accordion potatoes",
      ingredientSections: [
        {
          name: null,
          ingredients: [
            { index: 0, name: "potatoes", quantity: null, unit: null },
          ],
        },
      ],
      instructionSections: [
        {
          name: null,
          instructions: [
            { index: 0, instruction: "Cut the potatoes and bake." },
          ],
        },
      ],
    };
    const { parser, complete } = setup(potatoRecipe);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse(facebookHtml(accordionPotatoes)))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2]), {
          headers: { "content-type": "audio/mp4" },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          text: "Cut the potatoes into thin slices, then bake the potatoes in the oven.",
        }),
      );
    vi.stubGlobal("fetch", fetch);
    const result = await parser.parse({
      type: "url",
      data: accordionPotatoes.sourceUrl,
      strategy: "ai-assisted",
    });
    expect(result).toMatchObject({
      success: true,
      data: { name: "Accordion potatoes" },
    });
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "https://api.groq.com/openai/v1/audio/transcriptions",
      expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
    );
    expect(JSON.stringify(complete.mock.calls)).toContain("Cut the potatoes");
  });

  it("does not invent a potato recipe when audio is music only (synthetic transcript)", async () => {
    const { parser, complete } = setup();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(htmlResponse(facebookHtml(accordionPotatoes)))
        .mockResolvedValueOnce(
          new Response(new Uint8Array([1]), {
            headers: { "content-type": "audio/mp4" },
          }),
        )
        .mockResolvedValueOnce(
          Response.json({ text: "[Instrumental music, no speech]" }),
        ),
    );
    expect(
      await parser.parse({
        type: "url",
        data: accordionPotatoes.sourceUrl,
        strategy: "ai-assisted",
      }),
    ).toMatchObject({
      success: false,
      error: { code: "IMPORT_RECIPE_NOT_FOUND", disposition: "terminal" },
    });
    expect(complete).not.toHaveBeenCalled();
  });

  it("keeps transient audio failures retryable and preserves Retry-After", async () => {
    const { parser } = setup();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(htmlResponse(facebookHtml(accordionPotatoes)))
        .mockResolvedValueOnce(
          new Response(new Uint8Array([1]), {
            headers: { "content-type": "audio/mp4" },
          }),
        )
        .mockResolvedValueOnce(
          Response.json(
            { error: "Busy" },
            { status: 429, headers: { "retry-after": "20" } },
          ),
        ),
    );
    expect(
      await parser.parse({
        type: "url",
        data: accordionPotatoes.sourceUrl,
        strategy: "ai-assisted",
      }),
    ).toMatchObject({
      success: false,
      error: { disposition: "retry", retryAfterSeconds: 20 },
    });
  });

  it.each(["https://fb.watch/recipe/", tomatoSoup.sourceUrl])(
    "rejects %s in Basic Import without fetching",
    async (url) => {
      const { parser } = setup();
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
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

  it.each([404, 403])(
    "makes unavailable Facebook sources terminal (%s)",
    async (status) => {
      const { parser } = setup();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response("Unavailable", { status })),
      );
      expect(
        await parser.parse({
          type: "url",
          data: wheatThins.sourceUrl,
          strategy: "ai-assisted",
        }),
      ).toMatchObject({
        success: false,
        error: { code: "IMPORT_SOURCE_UNAVAILABLE", disposition: "terminal" },
      });
    },
  );

  it.each([
    {
      name: "complete",
      instructionSections: tomatoSoupRecipe.instructionSections,
    },
    { name: "missing-instructions", instructionSections: [] },
  ])(
    "accepts a $name linked recipe without further extraction",
    async ({ instructionSections }) => {
      const { env, complete } = setup();
      const sourceUrl = "https://www.facebook.com/reel/123/";
      const target = "https://recipe.example.com/soup";
      const html = facebookHtml({
        meta: { "og:url": sourceUrl },
        payload: {
          id: "123",
          owner: { id: "chef" },
          captions_url: "https://scontent.xx.fbcdn.net/captions.srt",
          feedback: {
            comments: [
              {
                author: { id: "chef" },
                body: {
                  text: `Full recipe: https://l.facebook.com/l.php?u=${encodeURIComponent(target)}&h=tracking`,
                },
              },
            ],
          },
        },
      });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(htmlResponse(html)));
      const linked = vi.fn().mockResolvedValue({
        success: true,
        data: { ...tomatoSoupRecipe, instructionSections, sourceUrl: target },
        metadata: { source: "url", confidence: "high", canonicalUrl: target },
      });
      const result = await parseSocialUrl(env, sourceUrl, "facebook", {
        aiClient: { complete },
        parseLinkedRecipeUrl: linked,
        diagnostics: {
          originalUrl: sourceUrl,
        },
      });
      expect(linked).toHaveBeenCalledWith(target);
      expect(result).toMatchObject({
        success: true,
        data: { sourceUrl: target, instructionSections },
        metadata: {
          diagnostics: {
            originalUrl: sourceUrl,
          },
        },
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(complete).not.toHaveBeenCalled();
    },
  );
});
