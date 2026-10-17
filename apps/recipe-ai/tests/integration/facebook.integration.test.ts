import { createExecutionContext, env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { RecipeAI } from "../../src/index";
import type { Env } from "../../src/types";
import { RECIPE_AI_INFERENCE_CLIENT } from "../../src/utils/ai-response-parser";
import {
  accordionPotatoes,
  tomatoSoup,
  tomatoSoupRecipe,
  wheatThins,
  wheatThinsRecipe,
} from "../fixtures/facebook";

function parserFor(recipe: unknown) {
  const complete = vi.fn().mockResolvedValue(JSON.stringify(recipe));
  const workerEnv = {
    ...env,
    GROQ_API_KEY: "fixture-key",
    IMAGE_PUBLIC_URL: "https://images.example.com",
    IMAGE_SERVICE: {
      uploadFromUrl: async (_url: string, key: string) => ({
        success: true,
        key,
        publicUrl: `https://images.example.com/${key}`,
      }),
    },
  } as unknown as Env;
  const parser = new RecipeAI(createExecutionContext(), workerEnv);
  parser[RECIPE_AI_INFERENCE_CLIENT] = () => ({ complete });
  return { parser, complete };
}

describe("Facebook imports in the Workers runtime", () => {
  it("imports the wheat reel using native fetch, subtitles and image staging", async () => {
    const { parser } = parserFor(wheatThinsRecipe);
    const result = await parser.parse({
      type: "url",
      data: wheatThins.sourceUrl,
      strategy: "ai-assisted",
      imageStagingId: "2d4976e7-c19b-46de-b893-dc18013097de",
    });
    expect(result).toMatchObject({
      success: true,
      data: { name: "Homemade Wheat Thins", servings: null },
    });
    if (result.success) expect(result.data.images?.[0]).toContain("/imports/");
  });

  it("resolves the soup share link and preserves both recipe sections", async () => {
    const { parser } = parserFor(tomatoSoupRecipe);
    const result = await parser.parse({
      type: "url",
      data: tomatoSoup.sourceUrl,
      strategy: "ai-assisted",
    });
    expect(result).toMatchObject({
      success: true,
      data: {
        name: "Creamy Tomato Soup & Vegan Grilled Cheese",
        sourceUrl: tomatoSoup.meta["og:url"],
      },
      metadata: { diagnostics: { originalUrl: tomatoSoup.sourceUrl } },
    });
    if (result.success) expect(result.data.instructionSections).toHaveLength(2);
  });

  it("uploads the potato audio but refuses synthetic music-only transcription", async () => {
    const { parser, complete } = parserFor(wheatThinsRecipe);
    const result = await parser.parse({
      type: "url",
      data: accordionPotatoes.sourceUrl,
      strategy: "ai-assisted",
    });
    expect(result).toMatchObject({
      success: false,
      error: { code: "IMPORT_RECIPE_NOT_FOUND", disposition: "terminal" },
    });
    expect(complete).not.toHaveBeenCalled();
  });
});
