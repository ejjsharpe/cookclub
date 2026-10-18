import { afterEach, describe, expect, it, vi } from "vitest";

import { RecipeAI } from "../../../src/index";
import type { Env } from "../../../src/types";
import {
  RECIPE_AI_INFERENCE_CLIENT,
  type AiClient,
} from "../../../src/utils/ai-response-parser";
import {
  comment,
  feedEntry,
  postUrl,
  recipeDraft,
  redditFeed,
  redditPost,
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
      .mockResolvedValueOnce(new Response("blocked", { status: 403 }))
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
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("keeps the public feed's rate-limit reset in the import retry result", async () => {
    const { parser, complete } = setup();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("blocked", { status: 403 }))
      .mockResolvedValueOnce(
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
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("preserves a short shared URL in diagnostics without generic redirect fetching", async () => {
    const { parser } = setup();
    const fetch = vi.fn().mockResolvedValue(Response.json(redditPost()));
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
          Response.json(
            redditPost({
              selftext: "Recipe in the image",
              url: "https://i.redd.it/card.webp",
            }),
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
        Response.json(
          redditPost({
            selftext: "Recipe card",
            url: "https://i.redd.it/card.jpg",
          }),
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
      payload: redditPost({ url: "https://i.redd.it/bread.jpg" }),
      selectedAttempt: "reddit_post",
    },
    {
      label: "author comment",
      payload: redditPost(
        { selftext: "Recipe in comments", url: "https://i.redd.it/bread.jpg" },
        [comment()],
      ),
      selectedAttempt: "reddit_comments",
    },
    {
      label: "Spotlight recipe",
      payload: redditPost(
        { selftext: "", url: "https://i.redd.it/bread.jpg" },
        [
          comment({
            author: "spotlight-app",
            stickied: true,
            body: `OP has pinned a [comment](${postUrl}original1/):\n${writtenRecipe
              .split("\n")
              .map((line) => `> ${line}`)
              .join("\n")}`,
          }),
        ],
      ),
      selectedAttempt: "reddit_comments",
    },
  ])(
    "imports a $label through the existing AI and staged image pipeline",
    async ({ payload, selectedAttempt }) => {
      const { parser, complete, uploadFromUrl } = setup();
      const fetch = vi.fn().mockResolvedValue(Response.json(payload));
      vi.stubGlobal("fetch", fetch);
      const result = await parser.parse({
        type: "url",
        data: postUrl,
        strategy: "ai-assisted",
        imageStagingId: "2d4976e7-c19b-46de-b893-dc18013097de",
      });
      expect(result).toMatchObject({
        success: true,
        data: { name: "Test flatbread", sourceType: "url", sourceUrl: postUrl },
        metadata: {
          diagnostics: {
            originalUrl: postUrl,
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
        Response.json(
          redditPost({
            selftext: "Recipe here",
            url_overridden_by_dest: target,
          }),
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
        Response.json(
          redditPost({
            selftext: "Grandma's recipe cards",
            gallery_data: { items: [{ media_id: "one" }, { media_id: "two" }] },
            media_metadata: {
              one: {
                e: "Image",
                status: "valid",
                s: { u: "https://i.redd.it/one.jpg" },
              },
              two: {
                e: "Image",
                status: "valid",
                s: { u: "https://i.redd.it/two.jpg" },
              },
            },
          }),
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
          Response.json(
            redditPost({
              selftext: "Dinner tonight!",
              url: "https://i.redd.it/food.jpg",
            }),
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

  it("combines a video's ingredient caption with its audio transcript", async () => {
    const { parser, complete } = setup();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          redditPost({
            selftext: "Ingredients:\n- 2 cups flour\n- 1 cup water",
            secure_media: {
              reddit_video: {
                has_audio: true,
                dash_url: "https://v.redd.it/video1/DASHPlaylist.mpd",
              },
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          '<MPD><Period><AdaptationSet mimeType="audio/mp4"><Representation><BaseURL>DASH_AUDIO_128.mp4</BaseURL></Representation></AdaptationSet></Period></MPD>',
        ),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2]), {
          headers: { "content-type": "audio/mp4" },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          text: "Mix flour and water in a bowl, then bake in the oven.",
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
      success: true,
      metadata: { diagnostics: { selectedAttempt: "reddit_audio" } },
    });
    expect(String(fetch.mock.calls[3]?.[0])).toContain("/audio/transcriptions");
    expect(JSON.stringify(complete.mock.calls)).toContain("Audio transcript:");
    expect(JSON.stringify(complete.mock.calls)).toContain("2 cups flour");
  });

  it("rejects questions and unrelated commenters' recipes without calling AI", async () => {
    const { parser, complete } = setup();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            redditPost({ selftext: "Any good soup suggestions?" }, [
              comment({ author: "reader" }),
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
