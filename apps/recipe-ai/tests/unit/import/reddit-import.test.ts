import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RecipeAI } from "../../../src/index";
import type { Env } from "../../../src/types";
import {
  RECIPE_AI_INFERENCE_CLIENT,
  type AiClient,
} from "../../../src/utils/ai-response-parser";
import {
  feedEntry,
  galleryPostUrl,
  galleryShareUrl,
  postUrl,
  recipeDraft,
  redditFeed,
  reportedPostUrl,
  reportedShareUrl,
  writtenRecipe,
} from "../../fixtures/reddit";

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

function setup() {
  const complete = vi.fn().mockResolvedValue(JSON.stringify(recipeDraft));
  const uploadFromUrl = vi.fn(async (_url: string, key: string) => ({
    success: true,
    key,
    publicUrl: `https://images.example.com/${key}`,
  }));
  const normalizeImage = vi.fn(async (imageData: ArrayBuffer) => ({
    success: true,
    imageData,
  }));
  const env = {
    GROQ_API_KEY: "test-key",
    RECIPE_CACHE: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
    },
    IMAGE_PUBLIC_URL: "https://images.example.com",
    IMAGE_SERVICE: { uploadFromUrl, normalizeImage },
  } as unknown as Env;
  return {
    complete,
    uploadFromUrl,
    normalizeImage,
    parser: new TestParser(env, { complete }),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("Reddit Smart Import", () => {
  it.each([galleryPostUrl, galleryShareUrl])(
    "imports %s with staged gallery images and source diagnostics",
    async (url) => {
      const { parser, uploadFromUrl } = setup();
      const post = galleryPostUrl;
      const embed = readFileSync(
        new URL("../../fixtures/reddit-gallery-embed.html", import.meta.url),
        "utf8",
      );
      const fetch = vi.fn();
      if (url === galleryShareUrl) {
        fetch.mockResolvedValueOnce(
          new Response(null, { status: 301, headers: { location: post } }),
        );
      }
      fetch
        .mockResolvedValueOnce(
          new Response(
            redditFeed([
              feedEntry({
                id: "t3_1x8sssh",
                url: post,
                html: `<div class="md"><p>${writtenRecipe}</p></div><a href="https://www.reddit.com/gallery/1x8sssh">[link]</a>`,
              }),
            ]),
          ),
        )
        .mockResolvedValueOnce(new Response(embed));
      vi.stubGlobal("fetch", fetch);
      const result = await parser.parse({
        type: "url",
        data: url,
        strategy: "ai-assisted",
        imageStagingId: "2d4976e7-c19b-46de-b893-dc18013097de",
      });
      expect(result.success).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(url === galleryShareUrl ? 3 : 2);
      expect(uploadFromUrl).toHaveBeenCalled();
      expect(uploadFromUrl.mock.calls[0]?.[0]).toContain("mlya5a9x85wh1.jpg");
      if (result.success) {
        expect(result.data.sourceUrl).toBe(post);
        expect(result.metadata.diagnostics?.originalUrl).toBe(url);
        expect(result.data.images?.[0]).toContain("/imports/");
        expect(result.metadata.diagnostics?.fallbackPath).toEqual(
          expect.arrayContaining(["reddit_embed_images"]),
        );
        expect(result.metadata.diagnostics?.stageTimings).toContainEqual(
          expect.objectContaining({
            name: "reddit_fetch",
            detail: "feed;images:3",
          }),
        );
      }
    },
  );

  it("imports the reported app share through the public feed and existing image pipeline", async () => {
    const { parser, complete, uploadFromUrl } = setup();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 301,
          headers: { location: reportedPostUrl },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          redditFeed([
            feedEntry({
              id: "t3_1x71123",
              url: reportedPostUrl,
              html: `<div class="md"><p>${writtenRecipe}</p></div> submitted by <a href="https://reddit.com/user/testcook">testcook</a> <a href="https://i.redd.it/bread.jpg">[link]</a>`,
            }),
          ]),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    expect(
      await parser.parse({
        type: "url",
        data: reportedShareUrl,
        strategy: "ai-assisted",
      }),
    ).toMatchObject({
      success: true,
      data: { name: "Test flatbread", sourceUrl: reportedPostUrl },
      metadata: {
        diagnostics: {
          originalUrl: reportedShareUrl,
          platform: "reddit",
          selectedAttempt: "reddit_post",
        },
      },
    });
    expect(JSON.stringify(complete.mock.calls)).toContain("2 cups flour");
    expect(uploadFromUrl).toHaveBeenCalledTimes(1);
    expect(uploadFromUrl.mock.calls[0]?.[0]).toBe(
      "https://i.redd.it/bread.jpg",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps the public feed's rate-limit reset in the import retry result", async () => {
    const { parser, complete } = setup();
    const fetch = vi.fn().mockResolvedValueOnce(
      new Response("", {
        status: 429,
        headers: { "x-ratelimit-reset": "20" },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    expect(
      await parser.parse({
        type: "url",
        data: postUrl,
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
    expect(complete).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("preserves a short shared URL in diagnostics without generic redirect fetching", async () => {
    const { parser } = setup();
    const fetch = vi.fn().mockResolvedValue(new Response(redditFeed()));
    vi.stubGlobal("fetch", fetch);
    expect(
      await parser.parse({
        type: "url",
        data: "https://redd.it/abc123",
        strategy: "ai-assisted",
      }),
    ).toMatchObject({
      success: true,
      data: { sourceUrl: postUrl },
      metadata: {
        diagnostics: {
          originalUrl: "https://redd.it/abc123",
          platform: "reddit",
        },
      },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("normalises Reddit WebP images before requesting vision extraction", async () => {
    const { parser, complete, normalizeImage } = setup();
    complete.mockImplementation(async (kind) =>
      kind === "vision" ? writtenRecipe : JSON.stringify(recipeDraft),
    );
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            redditFeed([
              feedEntry({
                html: '<div class="md">Recipe in the image<img src="https://i.redd.it/card.webp"></div>',
              }),
            ]),
          ),
        )
        .mockResolvedValueOnce(
          new Response(new Uint8Array([1, 2, 3]), {
            headers: { "content-type": "image/webp" },
          }),
        ),
    );
    expect(
      await parser.parse({
        type: "url",
        data: postUrl,
        strategy: "ai-assisted",
      }),
    ).toMatchObject({ success: true });
    expect(normalizeImage).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      "image/webp",
    );
    expect(JSON.stringify(complete.mock.calls[0])).toContain(
      "data:image/jpeg;base64,",
    );
    expect(JSON.stringify(complete.mock.calls[0])).not.toContain(
      "data:image/webp",
    );
  });

  it("does not follow media redirects to an arbitrary host", async () => {
    const { parser, complete } = setup();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          redditFeed([
            feedEntry({
              html: '<div class="md">Recipe card<img src="https://i.redd.it/card.jpg"></div>',
            }),
          ]),
        ),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/private" },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    expect(
      await parser.parse({
        type: "url",
        data: postUrl,
        strategy: "ai-assisted",
      }),
    ).toMatchObject({
      success: false,
      error: { code: "IMPORT_SOURCE_UNAVAILABLE", disposition: "terminal" },
    });
    expect(complete).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each([
    {
      label: "post body",
      payload: redditFeed([
        feedEntry({ thumbnail: "https://i.redd.it/bread.jpg" }),
      ]),
      selectedAttempt: "reddit_post",
    },
    {
      label: "author comment",
      payload: redditFeed([
        feedEntry({
          html: '<div class="md">Recipe in comments</div>',
          thumbnail: "https://i.redd.it/bread.jpg",
        }),
        feedEntry({ id: "t1_recipe1", url: `${postUrl}recipe1/` }),
      ]),
      selectedAttempt: "reddit_comments",
    },
    {
      label: "specifically shared comment from another author",
      sourceUrl: `${postUrl}recipe1/`,
      canonicalUrl: "https://www.reddit.com/comments/abc123/_/recipe1/",
      payload: redditFeed([
        feedEntry({ html: '<div class="md">Parent post</div>' }),
        feedEntry({
          id: "t1_recipe1",
          url: `${postUrl}recipe1/`,
          author: "anothercook",
          thumbnail: "https://i.redd.it/bread.jpg",
        }),
      ]),
      selectedAttempt: "reddit_comments",
    },
  ])(
    "imports a $label through the existing AI and staged image pipeline",
    async ({
      payload,
      selectedAttempt,
      sourceUrl = postUrl,
      canonicalUrl = postUrl,
    }) => {
      const { parser, complete, uploadFromUrl } = setup();
      const fetch = vi.fn().mockResolvedValue(new Response(payload));
      vi.stubGlobal("fetch", fetch);
      const result = await parser.parse({
        type: "url",
        data: sourceUrl,
        strategy: "ai-assisted",
        imageStagingId: "2d4976e7-c19b-46de-b893-dc18013097de",
      });
      expect(result).toMatchObject({
        success: true,
        data: {
          name: "Test flatbread",
          sourceType: "url",
          sourceUrl: canonicalUrl,
        },
        metadata: {
          diagnostics: {
            originalUrl: sourceUrl,
            platform: "reddit",
            selectedAttempt,
          },
        },
      });
      expect(complete.mock.calls[0]?.[0]).toBe("text");
      expect(JSON.stringify(complete.mock.calls)).toContain("2 cups flour");
      expect(uploadFromUrl).toHaveBeenCalledTimes(1);
      expect(uploadFromUrl.mock.calls[0]?.[1]).toContain(
        "imports/2d4976e7-c19b-46de-b893-dc18013097de/",
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("imports the linked recipe using the existing website parser", async () => {
    const { parser, complete } = setup();
    const target = "https://food.example/flatbread";
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          redditFeed([
            feedEntry({
              html: `<div class="md">Recipe here</div><a href="${target}">[link]</a>`,
            }),
          ]),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Recipe", name: "Test flatbread", recipeYield: "2 servings", recipeIngredient: ["2 cups flour", "1 cup water"], recipeInstructions: [{ "@type": "HowToStep", text: "Mix flour and water in a bowl, then bake in the oven." }] })}</script>`,
        ),
      );
    vi.stubGlobal("fetch", fetch);
    expect(
      await parser.parse({
        type: "url",
        data: postUrl,
        strategy: "ai-assisted",
      }),
    ).toMatchObject({
      success: true,
      data: { sourceUrl: target },
      metadata: {
        parseMethod: "schema_org",
        diagnostics: { platform: "reddit", originalUrl: postUrl },
      },
    });
    expect(complete).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reads written recipe text across gallery images before normal social extraction", async () => {
    const { parser, complete } = setup();
    complete.mockImplementation(async (kind) =>
      kind === "vision" ? writtenRecipe : JSON.stringify(recipeDraft),
    );
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          redditFeed([
            feedEntry({
              html: '<div class="md">Grandma’s recipe cards<img src="https://i.redd.it/one.jpg"><img src="https://i.redd.it/two.jpg"></div>',
            }),
          ]),
        ),
      )
      .mockImplementation(
        async () =>
          new Response(new Uint8Array([1, 2, 3]), {
            headers: { "content-type": "image/jpeg" },
          }),
      );
    vi.stubGlobal("fetch", fetch);
    const result = await parser.parse({
      type: "url",
      data: postUrl,
      strategy: "ai-assisted",
    });
    expect(result).toMatchObject({
      success: true,
      data: { sourceType: "url", sourceUrl: postUrl },
      metadata: {
        parseMethod: "media_enriched",
        diagnostics: { selectedAttempt: "reddit_images" },
      },
    });
    expect(complete.mock.calls.map((call) => call[0])).toEqual([
      "vision",
      "text",
    ]);
    expect(complete.mock.calls[0]?.[1].messages[1].content).toHaveLength(3);
    expect(JSON.stringify(complete.mock.calls[1])).toContain("2 cups flour");
  });

  it("does not invent a recipe from a food photo", async () => {
    const { parser, complete } = setup();
    complete.mockResolvedValue("NO_RECIPE_TEXT");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            redditFeed([
              feedEntry({
                html: '<div class="md">Dinner tonight!<img src="https://i.redd.it/food.jpg"></div>',
              }),
            ]),
          ),
        )
        .mockResolvedValueOnce(
          new Response(new Uint8Array([1]), {
            headers: { "content-type": "image/jpeg" },
          }),
        ),
    );
    expect(
      await parser.parse({
        type: "url",
        data: postUrl,
        strategy: "ai-assisted",
      }),
    ).toMatchObject({
      success: false,
      error: { code: "IMPORT_RECIPE_NOT_FOUND" },
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]?.[0]).toBe("vision");
  });

  it("rejects questions and unrelated commenters' recipes without calling AI", async () => {
    const { parser, complete } = setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          redditFeed([
            feedEntry({
              html: '<div class="md">Any good soup suggestions?</div>',
            }),
            feedEntry({
              id: "t1_recipe1",
              url: `${postUrl}recipe1/`,
              author: "reader",
            }),
          ]),
        ),
      ),
    );
    expect(
      await parser.parse({
        type: "url",
        data: postUrl,
        strategy: "ai-assisted",
      }),
    ).toMatchObject({
      success: false,
      error: { code: "IMPORT_RECIPE_NOT_FOUND", disposition: "terminal" },
    });
    expect(complete).not.toHaveBeenCalled();
  });

  it.each([
    "https://www.reddit.com/r/recipes/",
    "https://www.reddit.com/user/chef/",
  ])("rejects %s before fetching", async (url) => {
    const { parser } = setup();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
      await parser.parse({ type: "url", data: url, strategy: "ai-assisted" }),
    ).toMatchObject({
      success: false,
      error: { code: "IMPORT_UNSUPPORTED_SOURCE" },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    postUrl,
    "https://redd.it/abc123",
    "https://www.reddit.com/r/recipes/s/Share123",
  ])(
    "routes %s to Smart Import before fetching in Basic Import",
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

  it.each([403, 404, 410])(
    "uses the existing terminal error for unavailable Reddit sources (%s)",
    async (status) => {
      const { parser } = setup();
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockImplementation(
            async () => new Response("Unavailable", { status }),
          ),
      );
      expect(
        await parser.parse({
          type: "url",
          data: postUrl,
          strategy: "ai-assisted",
        }),
      ).toMatchObject({
        success: false,
        error: { code: "IMPORT_SOURCE_UNAVAILABLE", disposition: "terminal" },
      });
    },
  );

  it("preserves retry-after and does not fall back on rate limiting", async () => {
    const { parser } = setup();
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response("Busy", { status: 429, headers: { "retry-after": "20" } }),
      );
    vi.stubGlobal("fetch", fetch);
    expect(
      await parser.parse({
        type: "url",
        data: postUrl,
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
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("maps transport timeouts to the existing retryable error", async () => {
    const { parser } = setup();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(
          new DOMException("Request timed out", "TimeoutError"),
        ),
    );
    expect(
      await parser.parse({
        type: "url",
        data: postUrl,
        strategy: "ai-assisted",
      }),
    ).toMatchObject({
      success: false,
      error: { code: "IMPORT_TIMED_OUT", disposition: "retry" },
    });
  });
});
