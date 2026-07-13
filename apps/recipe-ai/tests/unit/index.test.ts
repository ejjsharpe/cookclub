import { describe, it, expect, vi, beforeEach } from "vitest";

import { RecipeAI } from "../../src/index";

const SOCIAL_TEXT_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";

const browserFetcherMocks = vi.hoisted(() => ({
  fetchHtmlWithBrowser: vi.fn(),
}));

vi.mock("../../src/utils/browser-fetcher", () => {
  const browserRequiredDomains = [
    "instagram.com",
    "tiktok.com",
    "facebook.com",
    "fb.com",
    "youtube.com",
    "youtu.be",
    "pinterest.com",
    "pin.it",
    "threads.net",
    "x.com",
    "twitter.com",
    "reddit.com",
  ];

  return {
    requiresBrowserRendering: (url: string) => {
      try {
        const hostname = new URL(url).hostname;
        return browserRequiredDomains.some(
          (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
        );
      } catch {
        return false;
      }
    },
    fetchHtmlWithBrowser: browserFetcherMocks.fetchHtmlWithBrowser,
  };
});

// Valid AI response for mocking
const validAiResponse = JSON.stringify({
  name: "Test Recipe",
  description: "A delicious test recipe",
  prepTime: "PT15M",
  cookTime: "PT30M",
  totalTime: "PT45M",
  servings: 4,
  ingredientSections: [
    {
      name: null,
      ingredients: [
        { index: 0, quantity: 2, unit: "cup", name: "flour" },
        { index: 1, quantity: 1, unit: "tsp", name: "salt" },
      ],
    },
  ],
  instructionSections: [
    {
      name: null,
      instructions: [
        { index: 0, instruction: "Mix ingredients" },
        { index: 1, instruction: "Bake at 350F" },
      ],
    },
  ],
  suggestedTags: ["American"],
});

// Sample HTML page
const sampleHtml = `
<html>
  <body>
    <article>
      <h1>Recipe Title</h1>
      <p>This is a recipe page.</p>
      <h2>Ingredients</h2>
      <ul>
        <li>2 cups flour</li>
        <li>1 tsp salt</li>
      </ul>
      <h2>Instructions</h2>
      <ol>
        <li>Mix everything</li>
        <li>Bake it</li>
      </ol>
    </article>
  </body>
</html>
`;

const aiOnlyHtml = `
<html>
  <body>
    <article>
      ${"This page has a long recipe story with enough content for AI extraction. ".repeat(10)}
    </article>
  </body>
</html>
`;

const recipeWithoutNutrition = {
  name: "Weeknight Pasta",
  description: "A simple pasta dinner",
  servings: 4,
  sourceUrl: null,
  ingredientSections: [
    {
      name: null,
      ingredients: [
        { index: 0, quantity: 400, unit: "g", name: "spaghetti" },
        { index: 1, quantity: 2, unit: "tbsp", name: "olive oil" },
        { index: 2, quantity: 1, unit: "cup", name: "tomato sauce" },
      ],
    },
  ],
  instructionSections: [
    {
      name: null,
      instructions: [
        { index: 0, instruction: "Boil the pasta." },
        { index: 1, instruction: "Toss with sauce and oil." },
      ],
    },
  ],
};

// Create mock environment
function createMockEnv() {
  const kvStore = new Map<string, string>();

  return {
    AI: {
      run: vi.fn().mockResolvedValue({ response: validAiResponse }),
    },
    RECIPE_CACHE: {
      get: vi.fn((key: string, type?: string) => {
        const value = kvStore.get(key);
        if (!value) return Promise.resolve(null);
        if (type === "json") return Promise.resolve(JSON.parse(value));
        return Promise.resolve(value);
      }),
      put: vi.fn((key: string, value: string) => {
        kvStore.set(key, value);
        return Promise.resolve();
      }),
    },
    IMAGE_PUBLIC_URL: "https://images.example.com",
    YOUTUBE_API_KEY: "test-youtube-key",
    IMAGE_SERVICE: {
      uploadFromUrl: vi.fn(async (_sourceUrl: string, key: string) => ({
        success: true,
        publicUrl: `https://images.example.com/${key}`,
        key,
      })),
      uploadImage: vi.fn(async () => ({
        success: true,
        publicUrl: "https://images.example.com/temp/generated/source.jpg",
        key: "temp/generated/source.jpg",
      })),
    },
    _kvStore: kvStore,
  };
}

// Create parser instance with mock env
function createParser(env: ReturnType<typeof createMockEnv>) {
  const parser = new (RecipeAI as any)();
  parser.env = env;
  return parser;
}

describe("RecipeAI.parse()", () => {
  let mockEnv: ReturnType<typeof createMockEnv>;
  let parser: RecipeAI;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockEnv = createMockEnv();
    parser = createParser(mockEnv);
    browserFetcherMocks.fetchHtmlWithBrowser
      .mockReset()
      .mockResolvedValue(sampleHtml);

    // Default: mock fetch to return sample HTML
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      arrayBuffer: () =>
        Promise.resolve(new TextEncoder().encode(sampleHtml).buffer),
      text: () => Promise.resolve(sampleHtml),
    });
  });

  describe("URL parsing flow", () => {
    it("returns cached result on cache hit", async () => {
      const cachedRecipe = {
        name: "Cached Recipe",
        ingredientSections: [
          {
            name: null,
            ingredients: [
              { index: 0, name: "cached" },
              { index: 1, name: "extra cached ingredient" },
            ],
          },
        ],
        instructionSections: [
          { name: null, instructions: [{ index: 0, instruction: "cached" }] },
        ],
      };

      mockEnv.RECIPE_CACHE.get = vi.fn().mockResolvedValue(cachedRecipe);

      const result = await parser.parse({
        type: "url",
        data: "https://example.com/recipe",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.metadata.cached).toBe(true);
        expect(result.data.name).toBe("Cached Recipe");
      }
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("parses visible recipe cards without AI", async () => {
      const result = await parser.parse({
        type: "url",
        data: "https://example.com/recipe",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Recipe Title");
        expect(result.metadata.parseMethod).toBe("visible_card");
        expect(result.metadata.confidence).toBe("medium");
        expect(result.metadata.canonicalUrl).toBe("https://example.com/recipe");
        expect(result.metadata.diagnostics?.selectedAttempt).toBeTruthy();
        expect(result.metadata.diagnostics?.qualityScore).toEqual(
          expect.any(Number),
        );
        expect(result.metadata.diagnostics?.totalElapsedMs).toEqual(
          expect.any(Number),
        );
        expect(
          result.metadata.diagnostics?.stageTimings?.map((stage) => stage.name),
        ).toEqual(
          expect.arrayContaining([
            "cache",
            "fetch",
            "deterministic_parse",
            "image_rehosting",
          ]),
        );
        expect(mockEnv.AI.run).not.toHaveBeenCalled();
      }
    });

    it("rehosts structured cover and HowToStep images before returning", async () => {
      const structuredHtml = `
        <html>
          <head>
            <script type="application/ld+json">
              ${JSON.stringify({
                "@context": "https://schema.org",
                "@type": "Recipe",
                name: "Carrot Soup",
                image: ["https://example.com/cover.jpg"],
                recipeYield: "2 servings",
                recipeIngredient: ["1 cup stock", "2 carrots"],
                recipeInstructions: [
                  {
                    "@type": "HowToStep",
                    text: "Chop the carrots.",
                    image: "https://example.com/step.jpg",
                  },
                  {
                    "@type": "HowToStep",
                    text: "Simmer until tender.",
                  },
                ],
              })}
            </script>
          </head>
          <body></body>
        </html>
      `;
      const uploadFromUrl = vi.fn(
        async (_sourceUrl: string, destinationKey: string) => ({
          success: true,
          publicUrl: `https://images.example.com/${destinationKey}`,
          key: destinationKey,
        }),
      );
      mockEnv.IMAGE_SERVICE.uploadFromUrl = uploadFromUrl;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        arrayBuffer: () =>
          Promise.resolve(new TextEncoder().encode(structuredHtml).buffer),
        text: () => Promise.resolve(structuredHtml),
      });

      const result = await parser.parse({
        type: "url",
        data: "https://example.com/recipe",
        structuredOnly: true,
      });

      expect(result.success).toBe(true);
      expect(uploadFromUrl).toHaveBeenCalledWith(
        "https://example.com/cover.jpg",
        expect.stringMatching(/^temp\/generated\/[a-zA-Z0-9-]+\.jpg$/),
      );
      expect(uploadFromUrl).toHaveBeenCalledWith(
        "https://example.com/step.jpg",
        expect.stringMatching(/^temp\/generated\/[a-zA-Z0-9-]+\.jpg$/),
      );

      if (result.success) {
        expect(result.data.images).toEqual([
          expect.stringMatching(
            /^https:\/\/images\.example\.com\/temp\/generated\/[a-zA-Z0-9-]+\.jpg$/,
          ),
        ]);
        expect(
          result.data.instructionSections[0]?.instructions[0]?.imageUrl,
        ).toMatch(
          /^https:\/\/images\.example\.com\/temp\/generated\/[a-zA-Z0-9-]+\.jpg$/,
        );
      }

      const cachedRecipe = JSON.parse(
        mockEnv.RECIPE_CACHE.put.mock.calls[0]?.[1] as string,
      );
      expect(cachedRecipe.images).toEqual(["https://example.com/cover.jpg"]);
      expect(cachedRecipe.instructionSections[0].instructions[0].imageUrl).toBe(
        "https://example.com/step.jpg",
      );
    });

    it("drops failed step-image rehosting while keeping a hosted cover", async () => {
      const cachedRecipe = {
        name: "Cached Soup",
        images: ["https://example.com/cover.jpg"],
        ingredientSections: [
          {
            name: null,
            ingredients: [
              { index: 0, name: "stock" },
              { index: 1, name: "carrots" },
            ],
          },
        ],
        instructionSections: [
          {
            name: null,
            instructions: [
              {
                index: 0,
                instruction: "Chop the carrots.",
                imageUrl: "https://example.com/step.jpg",
              },
            ],
          },
        ],
      };
      mockEnv.RECIPE_CACHE.get = vi.fn().mockResolvedValue(cachedRecipe);
      mockEnv.IMAGE_SERVICE.uploadFromUrl = vi
        .fn()
        .mockResolvedValueOnce({
          success: true,
          publicUrl: "https://images.example.com/temp/generated/cover.jpg",
          key: "temp/generated/cover.jpg",
        })
        .mockResolvedValueOnce({
          success: false,
          error: "Step unavailable",
        });

      const result = await parser.parse({
        type: "url",
        data: "https://example.com/cached",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.images).toEqual([
          "https://images.example.com/temp/generated/cover.jpg",
        ]);
        expect(
          result.data.instructionSections[0]?.instructions[0]?.imageUrl,
        ).toBeNull();
      }
    });

    it("rejects parsed recipes when all cover image rehosting fails", async () => {
      const cachedRecipe = {
        name: "Cached Soup",
        images: ["https://example.com/cover.jpg"],
        ingredientSections: [
          { name: null, ingredients: [{ index: 0, name: "stock" }] },
        ],
        instructionSections: [
          {
            name: null,
            instructions: [{ index: 0, instruction: "Simmer the soup." }],
          },
        ],
      };
      mockEnv.RECIPE_CACHE.get = vi.fn().mockResolvedValue(cachedRecipe);
      mockEnv.IMAGE_SERVICE.uploadFromUrl = vi.fn().mockResolvedValue({
        success: false,
        error: "Cover unavailable",
      });

      const result = await parser.parse({
        type: "url",
        data: "https://example.com/cached",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("IMAGE_REHOST_FAILED");
        expect(
          result.metadata?.diagnostics?.stageTimings?.some(
            (stage) =>
              stage.name === "image_rehosting" && stage.status === "error",
          ),
        ).toBe(true);
        expect(result.metadata?.diagnostics?.totalElapsedMs).toEqual(
          expect.any(Number),
        );
      }
    });

    it("does not fetch fallback sources after accepting a visible recipe card", async () => {
      const fetchMock = global.fetch as ReturnType<typeof vi.fn>;

      const result = await parser.parse({
        type: "url",
        data: "https://example.com/recipe",
      });

      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://example.com/recipe",
        expect.anything(),
      );
      expect(mockEnv.AI.run).not.toHaveBeenCalled();
    });

    it("lets basic import use deterministic visible cards without AI", async () => {
      const result = await parser.parse({
        type: "url",
        data: "https://example.com/recipe",
        structuredOnly: true,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Recipe Title");
        expect(result.metadata.parseMethod).toBe("visible_card");
      }
      expect(mockEnv.AI.run).not.toHaveBeenCalled();
    });

    it("falls back to AI when deterministic extractors cannot produce a recipe", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        arrayBuffer: () =>
          Promise.resolve(new TextEncoder().encode(aiOnlyHtml).buffer),
        text: () => Promise.resolve(aiOnlyHtml),
      });

      const result = await parser.parse({
        type: "url",
        data: "https://example.com/recipe",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Test Recipe");
        expect(result.metadata.parseMethod).toBe("ai_only");
        expect(mockEnv.AI.run).toHaveBeenCalled();
      }
    });

    it("returns usable structured data without AI when present", async () => {
      const structuredHtml = `
        <html>
          <head>
            <script type="application/ld+json">
              {
                "@context": "https://schema.org",
                "@type": "Recipe",
                "name": "Structured Cake",
                "description": "A structured recipe.",
                "recipeYield": "Serves 8",
                "recipeIngredient": ["1 cup flour", "2 eggs"],
                "recipeInstructions": [
                  { "@type": "HowToStep", "text": "Mix the batter." },
                  { "@type": "HowToStep", "text": "Bake the cake." }
                ]
              }
            </script>
          </head>
          <body><article>${"Intro ".repeat(4000)}</article></body>
        </html>
      `;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        arrayBuffer: () =>
          Promise.resolve(new TextEncoder().encode(structuredHtml).buffer),
        text: () => Promise.resolve(structuredHtml),
      });

      const result = await parser.parse({
        type: "url",
        data: "https://example.com/structured-cake",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Structured Cake");
        expect(result.metadata.parseMethod).toBe("schema_org");
      }
      expect(mockEnv.AI.run).not.toHaveBeenCalled();
    });

    it("chooses the strongest structured candidate when a page exposes several", async () => {
      const structuredHtml = `
        <html>
          <head>
            <script type="application/ld+json">
              {
                "@context": "https://schema.org",
                "@type": "Recipe",
                "name": "Sparse Cake",
                "recipeIngredient": ["1 cup flour"],
                "recipeInstructions": ["Mix."]
              }
            </script>
            <script type="application/json">
              {
                "props": {
                  "pageProps": {
                    "recipe": {
                      "@context": "https://schema.org",
                      "@type": "Recipe",
                      "name": "Detailed Cake",
                      "description": "A richer structured candidate.",
                      "recipeYield": "Serves 8",
                      "totalTime": "PT45M",
                      "recipeIngredient": [
                        "1 cup flour",
                        "2 eggs",
                        "1 cup sugar",
                        "1 tsp vanilla"
                      ],
                      "recipeInstructions": [
                        "Mix the dry ingredients.",
                        "Whisk in the eggs.",
                        "Bake until golden."
                      ]
                    }
                  }
                }
              }
            </script>
          </head>
          <body></body>
        </html>
      `;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        arrayBuffer: () =>
          Promise.resolve(new TextEncoder().encode(structuredHtml).buffer),
        text: () => Promise.resolve(structuredHtml),
      });

      const result = await parser.parse({
        type: "url",
        data: "https://example.com/multiple-structured-candidates",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Detailed Cake");
        expect(result.metadata.parseMethod).toBe("schema_org");
      }
      expect(mockEnv.AI.run).not.toHaveBeenCalled();
    });

    it("uses AMP and print alternates before AI", async () => {
      const mainHtml = `
        <html>
          <head>
            <link rel="amphtml" href="https://example.com/amp/alternate-cake">
          </head>
          <body><article>${"Intro only. ".repeat(40)}</article></body>
        </html>
      `;
      const ampHtml = `
        <html>
          <head>
            <script type="application/ld+json">
              {
                "@context": "https://schema.org",
                "@type": "Recipe",
                "name": "AMP Cake",
                "image": "/amp-cake.jpg",
                "recipeIngredient": ["1 cup flour", "2 eggs"],
                "recipeInstructions": [
                  { "@type": "HowToStep", "text": "Mix the batter." },
                  { "@type": "HowToStep", "text": "Bake until done." }
                ]
              }
            </script>
          </head>
        </html>
      `;

      global.fetch = vi.fn((requestUrl: string | URL) => {
        const body = String(requestUrl).includes("/amp/alternate-cake")
          ? ampHtml
          : mainHtml;

        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "text/html" }),
          arrayBuffer: () =>
            Promise.resolve(new TextEncoder().encode(body).buffer),
          text: () => Promise.resolve(body),
        });
      }) as any;

      const result = await parser.parse({
        type: "url",
        data: "https://example.com/alternate-cake",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("AMP Cake");
        expect(result.data.sourceUrl).toBe(
          "https://example.com/alternate-cake",
        );
        expect(result.data.images).toEqual([
          expect.stringMatching(
            /^https:\/\/images\.example\.com\/temp\/generated\/[a-zA-Z0-9-]+\.jpg$/,
          ),
        ]);
        expect(result.metadata.parseMethod).toBe("schema_org");
      }
      expect(mockEnv.AI.run).not.toHaveBeenCalled();
    });

    it("uses WordPress REST content before AI", async () => {
      const mainHtml = `
        <html>
          <head><link rel="https://api.w.org/" href="https://example.com/wp-json/"></head>
          <body>
            <article class="wp-block-post-content">
              ${"A WordPress post intro without a recipe card. ".repeat(10)}
              <img src="/wp-content/uploads/story.jpg">
            </article>
          </body>
        </html>
      `;
      const restPost = [
        {
          title: { rendered: "WP Rest Pie" },
          excerpt: { rendered: "<p>A reliable pie.</p>" },
          content: {
            rendered: `
              <h2>Ingredients</h2>
              <ul>
                <li>2 cups apples</li>
                <li>1 cup flour</li>
              </ul>
              <h2>Instructions</h2>
              <ol>
                <li>Fill the pie.</li>
                <li>Bake until golden.</li>
              </ol>
            `,
          },
        },
      ];

      global.fetch = vi.fn((requestUrl: string | URL) => {
        if (String(requestUrl).includes("/wp-json/wp/v2/posts")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ "content-type": "application/json" }),
            json: () => Promise.resolve(restPost),
          });
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "text/html" }),
          arrayBuffer: () =>
            Promise.resolve(new TextEncoder().encode(mainHtml).buffer),
          text: () => Promise.resolve(mainHtml),
        });
      }) as any;

      const result = await parser.parse({
        type: "url",
        data: "https://example.com/wp-rest-pie",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("WP Rest Pie");
        expect(result.metadata.parseMethod).toBe("visible_card");
      }
      expect(mockEnv.AI.run).not.toHaveBeenCalled();
    });

    it("accepts ingredient-only TikTok AI output", async () => {
      const tiktokCaption =
        "fudgy browniess🤤 recipe by Handle the Heat: 5 tbsp butter 1 1/4 cups sugar 2 eggs plus 1 egg yolk 1 tsp vanilla 1/3 cup vegetable oil 3/4 cup cocoa powder 1/2 cup flour 1/8 tsp baking soda 1 tbsp cornstarch 1/4 tsp salt 3/4 cup chocolate chips #brownies #fudgybrownies #brownierecipe";

      mockEnv.AI.run = vi.fn().mockResolvedValue({
        response: JSON.stringify({
          name: "Fudgy Brownies",
          description: null,
          prepTime: null,
          cookTime: null,
          totalTime: null,
          servings: null,
          ingredientSections: [
            {
              name: null,
              ingredients: [
                { index: 0, quantity: 5, unit: "tbsp", name: "butter" },
              ],
            },
          ],
          instructionSections: [],
          suggestedTags: [],
          nutrition: {
            calories: "410 kcal",
            protein_g: "5 g",
            carbs_g: "48 g",
            total_fat: "24 g",
            confidence: "low",
          },
        }),
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: () =>
          Promise.resolve({
            title: tiktokCaption,
            thumbnail_url: "https://example.com/tiktok.jpg",
          }),
      });

      const result = await parser.parse({
        type: "url",
        data: "https://www.tiktok.com/@thelittlecakela/video/7208369840007007531",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Fudgy Brownies");
        expect(result.data.instructionSections).toEqual([]);
        expect(result.data.nutrition).toMatchObject({
          calories: 410,
          protein: 5,
          carbohydrates: 48,
          fat: 24,
          source: "ai_estimated",
          confidence: "low",
        });
        expect(result.metadata.parseMethod).toBe("ai_only");
        expect(result.metadata.confidence).toBe("low");
      }
      expect(mockEnv.AI.run).toHaveBeenCalledTimes(1);
    });

    it("canonicalizes TikTok short URLs before parsing and metadata", async () => {
      const canonicalTikTokUrl = "https://www.tiktok.com/@cook/video/123";
      const caption =
        "Tomato pasta Ingredients: 200 g spaghetti 1 cup tomato sauce Directions: 1. Boil the spaghetti. 2. Toss with tomato sauce.";

      mockEnv.AI.run = vi.fn().mockResolvedValue({
        response: JSON.stringify({
          name: "Tomato Pasta",
          description: null,
          prepTime: null,
          cookTime: 15,
          totalTime: null,
          servings: 2,
          ingredientSections: [
            {
              name: null,
              ingredients: [
                { index: 0, quantity: 200, unit: "g", name: "spaghetti" },
                { index: 1, quantity: 1, unit: "cup", name: "tomato sauce" },
              ],
            },
          ],
          instructionSections: [
            {
              name: null,
              instructions: [
                { index: 0, instruction: "Boil the spaghetti." },
                { index: 1, instruction: "Toss with tomato sauce." },
              ],
            },
          ],
        }),
      });

      global.fetch = vi.fn((requestUrl: string | URL) => {
        const requested = String(requestUrl);
        if (requested === "https://vm.tiktok.com/ZNRWJ2Wa9/") {
          return Promise.resolve({
            ok: false,
            status: 302,
            headers: new Headers({
              location: `${canonicalTikTokUrl}?utm_source=share`,
            }),
          });
        }

        if (requested.startsWith("https://www.tiktok.com/oembed")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ "content-type": "application/json" }),
            json: () =>
              Promise.resolve({
                title: caption,
                thumbnail_url: "https://example.com/tiktok.jpg",
              }),
          });
        }

        return Promise.resolve({
          ok: false,
          status: 404,
          headers: new Headers({ "content-type": "text/html" }),
          text: () => Promise.resolve(""),
        });
      }) as any;

      const result = await parser.parse({
        type: "url",
        data: "https://vm.tiktok.com/ZNRWJ2Wa9/?utm_medium=social",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sourceUrl).toBe(canonicalTikTokUrl);
        expect(result.metadata.canonicalUrl).toBe(canonicalTikTokUrl);
        expect(result.metadata.diagnostics?.originalUrl).toBe(
          "https://vm.tiktok.com/ZNRWJ2Wa9/",
        );
      }
    });

    it("imports a linked recipe page when a TikTok caption only contains the recipe URL", async () => {
      const linkedRecipeUrl = "https://recipe.example.com/tiktok-pasta";
      const linkedRecipeHtml = `
        <html>
          <body>
            <article>
              <h1>Linked TikTok Pasta</h1>
              <h2>Ingredients</h2>
              <ul>
                <li>200 g spaghetti</li>
                <li>1 cup tomato sauce</li>
              </ul>
              <h2>Instructions</h2>
              <ol>
                <li>Boil the spaghetti.</li>
                <li>Toss with tomato sauce.</li>
              </ol>
            </article>
          </body>
        </html>
      `;

      mockEnv.AI.run = vi.fn().mockResolvedValue({
        response: JSON.stringify({
          name: "Invalid Social Recipe",
          ingredientSections: [],
          instructionSections: [],
        }),
      });

      global.fetch = vi.fn((requestUrl: string | URL) => {
        const url = String(requestUrl);
        if (url.startsWith("https://www.tiktok.com/oembed")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ "content-type": "application/json" }),
            json: () =>
              Promise.resolve({
                title: `Recipe: ${linkedRecipeUrl}`,
                thumbnail_url: "https://example.com/tiktok.jpg",
              }),
          });
        }

        if (url === "https://www.tiktok.com/@cook/video/456") {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: () => Promise.resolve("<html></html>"),
          });
        }

        if (url === linkedRecipeUrl) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ "content-type": "text/html" }),
            arrayBuffer: () =>
              Promise.resolve(
                new TextEncoder().encode(linkedRecipeHtml).buffer,
              ),
            text: () => Promise.resolve(linkedRecipeHtml),
          });
        }

        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: "Not Found",
          headers: new Headers({ "content-type": "text/html" }),
        });
      }) as any;

      const result = await parser.parse({
        type: "url",
        data: "https://www.tiktok.com/@cook/video/456",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Linked TikTok Pasta");
        expect(result.data.sourceUrl).toBe(linkedRecipeUrl);
        expect(result.metadata.canonicalUrl).toBe(linkedRecipeUrl);
        expect(result.metadata.parseMethod).toBe("visible_card");
        const stageNames =
          result.metadata.diagnostics?.stageTimings?.map(
            (stage) => stage.name,
          ) ?? [];
        expect(stageNames).toContain("linked_url");
      }
      expect(mockEnv.AI.run).not.toHaveBeenCalled();
    });

    it("uses TikTok caption-only AI when no subtitles are available", async () => {
      const caption =
        "Quick tomato pasta with spaghetti, tomato sauce, olive oil and basil. Boil the pasta, warm the sauce, then toss together.";
      const captionAiRecipe = {
        name: "Tomato Pasta",
        description: null,
        prepTime: null,
        cookTime: 15,
        totalTime: null,
        servings: 2,
        ingredientSections: [
          {
            name: null,
            ingredients: [
              { index: 0, quantity: 200, unit: "g", name: "spaghetti" },
              { index: 1, quantity: 1, unit: "cup", name: "tomato sauce" },
            ],
          },
        ],
        instructionSections: [
          {
            name: null,
            instructions: [
              { index: 0, instruction: "Boil the spaghetti." },
              { index: 1, instruction: "Toss with tomato sauce." },
            ],
          },
        ],
      };

      mockEnv.AI.run = vi.fn((model: string) => {
        expect(model).toBe(SOCIAL_TEXT_MODEL);
        return Promise.resolve({ response: JSON.stringify(captionAiRecipe) });
      });

      global.fetch = vi.fn((requestUrl: string | URL) => {
        const url = String(requestUrl);
        if (url.startsWith("https://www.tiktok.com/oembed")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ "content-type": "application/json" }),
            json: () =>
              Promise.resolve({
                title: caption,
                thumbnail_url: "https://example.com/tiktok.jpg",
              }),
          });
        }

        return Promise.resolve({
          ok: false,
          status: 404,
          headers: new Headers({ "content-type": "text/html" }),
          text: () => Promise.resolve(""),
        });
      }) as any;

      const result = await parser.parse({
        type: "url",
        data: "https://www.tiktok.com/@cook/video/123",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Tomato Pasta");
        expect(result.metadata.parseMethod).toBe("ai_only");
      }
      expect(mockEnv.AI.run).toHaveBeenCalledTimes(1);
    });

    it("accepts ingredients-only Instagram AI output", async () => {
      const instagramCaption =
        "Easy tomato pasta Ingredients: 200 g spaghetti 1 cup tomato sauce Directions: 1. Boil the spaghetti. 2. Toss with tomato sauce and serve.";

      mockEnv.AI.run = vi.fn().mockResolvedValue({
        response: JSON.stringify({
          name: "Easy Tomato Pasta",
          description: null,
          prepTime: null,
          cookTime: null,
          totalTime: null,
          servings: null,
          ingredientSections: [
            {
              name: null,
              ingredients: [
                { index: 0, quantity: 200, unit: "g", name: "spaghetti" },
              ],
            },
          ],
          instructionSections: [],
          suggestedTags: [],
        }),
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: () =>
          Promise.resolve({
            title: instagramCaption,
            thumbnail_url: "https://example.com/instagram.jpg",
          }),
      });

      const result = await parser.parse({
        type: "url",
        data: "https://www.instagram.com/reel/ABC123/",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Easy Tomato Pasta");
        expect(result.data.ingredientSections[0]?.ingredients).toHaveLength(1);
        expect(result.data.instructionSections).toEqual([]);
        expect(result.metadata.parseMethod).toBe("ai_only");
        expect(result.metadata.confidence).toBe("low");
      }
      expect(mockEnv.AI.run).toHaveBeenCalledTimes(1);
    });

    it("retries mixed-language reel audio and incomplete transcript extraction", async () => {
      const instagramCaption =
        "Creamy tomato pasta with 200 g spaghetti, 1 cup tomato sauce, and 2 tbsp parmesan.";
      const transcript =
        "First boil the spaghetti until al dente. Simmer the tomato sauce, toss in the pasta, then finish with parmesan.";
      const audioUrl =
        "https://scontent.example.cdninstagram.com/reel-audio.mp4?token=abc";
      const crawlerPayload = {
        result: {
          data: {
            xig_polaris_media: {
              if_not_gated_logged_out: {
                code: "AUDIORECIPE123",
                pk: "123456",
                user: { username: "pasta_creator" },
                caption: { text: instagramCaption },
                display_uri: "https://example.com/crawler-cover.jpg",
                video_dash_manifest: `<?xml version="1.0"?><MPD><Period><AdaptationSet contentType="audio"><Representation mimeType="audio/mp4"><BaseURL>${audioUrl.replaceAll("&", "&amp;")}</BaseURL></Representation></AdaptationSet></Period></MPD>`,
              },
              comments_connection: { edges: [] },
            },
          },
        },
      };
      const crawlerHtml = `<html><body><script type="application/json">${JSON.stringify(
        crawlerPayload,
      )}</script></body></html>`;
      const ingredientsOnlyRecipe = {
        name: "Creamy Tomato Pasta",
        description: null,
        prepTime: null,
        cookTime: null,
        totalTime: null,
        servings: null,
        ingredientSections: [
          {
            name: null,
            ingredients: [
              { index: 0, quantity: 200, unit: "g", name: "spaghetti" },
              { index: 1, quantity: 1, unit: "cup", name: "tomato sauce" },
              { index: 2, quantity: 2, unit: "tbsp", name: "parmesan" },
            ],
          },
        ],
        instructionSections: [],
      };
      const instructions = [
        {
          index: 0,
          instruction: "Boil the spaghetti until al dente.",
        },
        {
          index: 1,
          instruction: "Simmer the tomato sauce and toss in the pasta.",
        },
        { index: 2, instruction: "Finish with parmesan." },
      ];
      const instructionsOnlyRecipe = {
        ...ingredientsOnlyRecipe,
        ingredientSections: [],
        instructionSections: [{ name: null, instructions }],
      };
      const completeRecipe = {
        ...ingredientsOnlyRecipe,
        instructionSections: [{ name: null, instructions }],
      };
      let transcriptionAttemptCount = 0;

      mockEnv.AI.run = vi.fn((model: string) => {
        if (model === "@cf/openai/whisper-large-v3-turbo") {
          transcriptionAttemptCount += 1;
          if (transcriptionAttemptCount === 1) {
            return Promise.reject(
              new Error(
                "Unsupported audio input: force a single language for audio with different languages",
              ),
            );
          }
          return Promise.resolve({ text: transcript, word_count: 19 });
        }

        const textAttemptCount = mockEnv.AI.run.mock.calls.filter(
          ([calledModel]) => calledModel === SOCIAL_TEXT_MODEL,
        ).length;
        return Promise.resolve({
          response: JSON.stringify(
            textAttemptCount === 1
              ? ingredientsOnlyRecipe
              : textAttemptCount === 2
                ? instructionsOnlyRecipe
                : completeRecipe,
          ),
        });
      });

      global.fetch = vi.fn((requestUrl: string | URL) => {
        const requested = String(requestUrl);
        if (requested.startsWith("https://www.instagram.com/api/v1/oembed")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ "content-type": "application/json" }),
            json: () =>
              Promise.resolve({
                title: instagramCaption,
                thumbnail_url: "https://example.com/oembed-cover.jpg",
              }),
          });
        }

        if (requested === audioUrl) {
          const audio = new Uint8Array([0, 1, 2, 3]);
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({
              "content-type": "audio/mp4",
              "content-length": String(audio.byteLength),
            }),
            arrayBuffer: () => Promise.resolve(audio.buffer),
          });
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({
            "content-type": "text/html",
            "content-length": String(
              new TextEncoder().encode(crawlerHtml).byteLength,
            ),
          }),
          arrayBuffer: () =>
            Promise.resolve(new TextEncoder().encode(crawlerHtml).buffer),
        });
      }) as any;

      const result = await parser.parse({
        type: "url",
        data: "https://www.instagram.com/reel/AUDIORECIPE123/",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.instructionSections[0]?.instructions).toHaveLength(
          3,
        );
        expect(result.metadata.parseMethod).toBe("media_enriched");
        expect(result.metadata.diagnostics?.selectedAttempt).toBe(
          "instagram_audio_retry",
        );
        expect(
          result.metadata.diagnostics?.stageTimings?.some(
            (stage) =>
              stage.name === "instagram_audio" && stage.status === "success",
          ),
        ).toBe(true);
      }
      expect(mockEnv.AI.run.mock.calls.map(([model]) => model)).toEqual([
        SOCIAL_TEXT_MODEL,
        "@cf/openai/whisper-large-v3-turbo",
        "@cf/openai/whisper-large-v3-turbo",
        SOCIAL_TEXT_MODEL,
        SOCIAL_TEXT_MODEL,
      ]);
      expect(mockEnv.AI.run.mock.calls[1]?.[1]).toMatchObject({
        audio: "AAECAw==",
        task: "transcribe",
        vad_filter: true,
        initial_prompt: expect.stringContaining("cooking recipe"),
      });
      expect(mockEnv.AI.run.mock.calls[1]?.[1]).toMatchObject({
        initial_prompt: expect.stringContaining(instagramCaption),
      });
      expect(mockEnv.AI.run.mock.calls[2]?.[1]).toMatchObject({
        language: "en",
      });
      expect(JSON.stringify(mockEnv.AI.run.mock.calls[4]?.[1])).toContain(
        transcript,
      );
    });

    it("adds a creator recipe comment to Instagram AI evidence", async () => {
      const instagramCaption =
        "Creamy tomato pasta 16 oz spaghetti | 4 tbsp butter | 2 cups broth. Full recipe in the comments.";
      const creatorComment =
        "Instructions: Cook the spaghetti until al dente. Melt the butter, add the broth, and simmer. Toss with the spaghetti and serve.";
      const crawlerPayload = {
        result: {
          data: {
            xig_polaris_media: {
              if_not_gated_logged_out: {
                code: "COMMENTRECIPE123",
                pk: "123456",
                user: { username: "pasta_creator" },
                caption: { text: instagramCaption },
                display_uri: "https://example.com/crawler-cover.jpg",
              },
              comments_connection: {
                edges: [
                  {
                    node: {
                      __typename: "XIGComment",
                      text: creatorComment,
                      user: { username: "pasta_creator" },
                      comment_like_count: 25,
                    },
                  },
                  {
                    node: {
                      __typename: "XIGComment",
                      text: "PASTA",
                      user: { username: "viewer" },
                      comment_like_count: 0,
                    },
                  },
                ],
              },
            },
          },
        },
      };
      const crawlerHtml = `<html><body><script type="application/json">${JSON.stringify(
        crawlerPayload,
      )}</script></body></html>`;

      mockEnv.AI.run = vi.fn().mockResolvedValue({
        response: JSON.stringify({
          name: "Creamy Tomato Pasta",
          description: null,
          prepTime: null,
          cookTime: null,
          totalTime: null,
          servings: null,
          ingredientSections: [
            {
              name: null,
              ingredients: [
                { index: 0, quantity: 16, unit: "oz", name: "spaghetti" },
                { index: 1, quantity: 4, unit: "tbsp", name: "butter" },
                { index: 2, quantity: 2, unit: "cup", name: "broth" },
              ],
            },
          ],
          instructionSections: [
            {
              name: null,
              instructions: [
                { index: 0, instruction: "Cook the spaghetti until al dente." },
                {
                  index: 1,
                  instruction: "Melt the butter, add the broth, and simmer.",
                },
                { index: 2, instruction: "Toss with the spaghetti and serve." },
              ],
            },
          ],
        }),
      });

      global.fetch = vi.fn((requestUrl: string | URL) => {
        const requested = String(requestUrl);
        if (requested.startsWith("https://www.instagram.com/api/v1/oembed")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ "content-type": "application/json" }),
            json: () =>
              Promise.resolve({
                title: instagramCaption,
                author_name: "pasta_creator",
                thumbnail_url: "https://example.com/oembed-cover.jpg",
              }),
          });
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({
            "content-type": "text/html",
            "content-length": String(
              new TextEncoder().encode(crawlerHtml).byteLength,
            ),
          }),
          arrayBuffer: () =>
            Promise.resolve(new TextEncoder().encode(crawlerHtml).buffer),
        });
      }) as any;

      const result = await parser.parse({
        type: "url",
        data: "https://www.instagram.com/reel/COMMENTRECIPE123/",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.instructionSections[0]?.instructions).toHaveLength(
          3,
        );
        expect(result.metadata.parseMethod).toBe("media_enriched");
        expect(
          result.metadata.diagnostics?.stageTimings?.some(
            (stage) =>
              stage.name === "instagram_comments" && stage.status === "success",
          ),
        ).toBe(true);
      }
      expect(mockEnv.AI.run).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(mockEnv.AI.run.mock.calls[0]?.[1])).toContain(
        creatorComment,
      );
    });

    it("retries Instagram captions when the fast model drops explicit ingredients", async () => {
      const instagramCaption = `Complete tomato pasta

Ingredients:
• 200 g spaghetti
• 1 cup tomato sauce
• 2 tbsp parmesan

Instructions:
1. Boil the spaghetti.
2. Toss with tomato sauce and parmesan.`;
      const baseRecipe = {
        name: "Complete Tomato Pasta",
        description: null,
        prepTime: null,
        cookTime: 15,
        totalTime: null,
        servings: 2,
        instructionSections: [
          {
            name: null,
            instructions: [
              { index: 0, instruction: "Boil the spaghetti." },
              {
                index: 1,
                instruction: "Toss with tomato sauce and parmesan.",
              },
            ],
          },
        ],
      };

      mockEnv.AI.run = vi
        .fn()
        .mockResolvedValueOnce({
          response: JSON.stringify({
            ...baseRecipe,
            ingredientSections: [
              {
                name: null,
                ingredients: [
                  { index: 0, quantity: 200, unit: "g", name: "spaghetti" },
                  {
                    index: 1,
                    quantity: 1,
                    unit: "cup",
                    name: "tomato sauce",
                  },
                ],
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          response: JSON.stringify({
            ...baseRecipe,
            ingredientSections: [
              {
                name: null,
                ingredients: [
                  { index: 0, quantity: 200, unit: "g", name: "spaghetti" },
                  {
                    index: 1,
                    quantity: 1,
                    unit: "cup",
                    name: "tomato sauce",
                  },
                  {
                    index: 2,
                    quantity: 2,
                    unit: "tbsp",
                    name: "parmesan",
                  },
                ],
              },
            ],
          }),
        });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: () =>
          Promise.resolve({
            title: instagramCaption,
            thumbnail_url: "https://example.com/instagram.jpg",
          }),
      });

      const result = await parser.parse({
        type: "url",
        data: "https://www.instagram.com/reel/INCOMPLETE123/",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ingredientSections[0]?.ingredients).toHaveLength(3);
        expect(result.metadata.diagnostics?.selectedAttempt).toBe(
          "ai_only_retry",
        );
      }
      expect(mockEnv.AI.run).toHaveBeenCalledTimes(2);
      expect(mockEnv.AI.run.mock.calls[0]?.[0]).toBe(SOCIAL_TEXT_MODEL);
      expect(mockEnv.AI.run.mock.calls[1]?.[0]).toBe(
        "@cf/meta/llama-4-scout-17b-16e-instruct",
      );
    });

    it("retries malformed social AI output with Scout", async () => {
      const instagramCaption =
        "Sheet pan chicken kefta Ingredients: 1.5 lb ground chicken 2 tbsp tomato paste. Directions: spread on a sheet pan and bake.";

      mockEnv.AI.run = vi
        .fn()
        .mockResolvedValueOnce({
          response:
            '{ "name": "Sheet Pan Chicken Kefta", "ingredientSections": [{ "name": null, "ingredients": [{ "index": 0, "quantity": 1.5, "unit": "lb", "name": "ground chicken", "pr',
        })
        .mockResolvedValueOnce({
          response: JSON.stringify({
            name: "Sheet Pan Chicken Kefta",
            description: null,
            prepTime: null,
            cookTime: 20,
            totalTime: null,
            servings: 4,
            ingredientSections: [
              {
                name: null,
                ingredients: [
                  {
                    index: 0,
                    quantity: 1.5,
                    unit: "lb",
                    name: "ground chicken",
                  },
                  {
                    index: 1,
                    quantity: 2,
                    unit: "tbsp",
                    name: "tomato paste",
                  },
                ],
              },
            ],
            instructionSections: [
              {
                name: null,
                instructions: [
                  {
                    index: 0,
                    instruction:
                      "Spread the chicken mixture on a sheet pan and bake.",
                  },
                ],
              },
            ],
            suggestedTags: ["dinner"],
          }),
        });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: () =>
          Promise.resolve({
            title: instagramCaption,
            thumbnail_url: "https://example.com/instagram.jpg",
          }),
      });

      const result = await parser.parse({
        type: "url",
        data: "https://www.instagram.com/reel/MALFORMED123/",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Sheet Pan Chicken Kefta");
        expect(
          result.metadata.diagnostics?.stageTimings?.map((stage) => [
            stage.name,
            stage.status,
          ]),
        ).toEqual(
          expect.arrayContaining([
            ["ai", "error"],
            ["ai_retry", "success"],
          ]),
        );
      }

      expect(mockEnv.AI.run).toHaveBeenCalledTimes(2);
      expect(mockEnv.AI.run.mock.calls[0]?.[0]).toBe(SOCIAL_TEXT_MODEL);
      expect(mockEnv.AI.run.mock.calls[1]?.[0]).toBe(
        "@cf/meta/llama-4-scout-17b-16e-instruct",
      );
    });

    it("imports a linked recipe page when an Instagram caption only contains the recipe URL", async () => {
      const linkedRecipeUrl = "https://recipe.example.com/tomato-pasta";
      const linkedRecipeHtml = `
        <html>
          <head>
            <script type="application/ld+json">
              ${JSON.stringify({
                "@context": "https://schema.org",
                "@type": "Recipe",
                name: "Linked Tomato Pasta",
                recipeYield: "2 servings",
                recipeIngredient: ["200 g spaghetti", "1 cup tomato sauce"],
                recipeInstructions: [
                  { "@type": "HowToStep", text: "Boil the spaghetti." },
                  { "@type": "HowToStep", text: "Toss with tomato sauce." },
                ],
              })}
            </script>
          </head>
          <body></body>
        </html>
      `;

      mockEnv.AI.run = vi.fn().mockResolvedValue({
        response: JSON.stringify({
          name: "Invalid Social Recipe",
          ingredientSections: [],
          instructionSections: [],
        }),
      });

      global.fetch = vi.fn((requestUrl: string | URL) => {
        const url = String(requestUrl);
        if (url.startsWith("https://www.instagram.com/api/v1/oembed")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ "content-type": "application/json" }),
            json: () =>
              Promise.resolve({
                title: `Recipe: ${linkedRecipeUrl}`,
                thumbnail_url: "https://example.com/instagram.jpg",
              }),
          });
        }

        if (url === linkedRecipeUrl) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ "content-type": "text/html" }),
            arrayBuffer: () =>
              Promise.resolve(
                new TextEncoder().encode(linkedRecipeHtml).buffer,
              ),
            text: () => Promise.resolve(linkedRecipeHtml),
          });
        }

        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: "Not Found",
          headers: new Headers({ "content-type": "text/html" }),
        });
      }) as any;

      const result = await parser.parse({
        type: "url",
        data: "https://www.instagram.com/reel/LINKONLY123/",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Linked Tomato Pasta");
        expect(result.data.sourceUrl).toBe(linkedRecipeUrl);
        expect(result.metadata.canonicalUrl).toBe(linkedRecipeUrl);
        expect(result.metadata.parseMethod).toBe("schema_org");
        expect(result.metadata.diagnostics?.originalUrl).toBe(
          "https://www.instagram.com/reel/LINKONLY123/",
        );
        const stageNames =
          result.metadata.diagnostics?.stageTimings?.map(
            (stage) => stage.name,
          ) ?? [];
        expect(stageNames).toContain("linked_url");
        expect(stageNames).not.toContain("ai");
      }
      expect(mockEnv.AI.run).not.toHaveBeenCalled();
    });

    it("parses YouTube recipe details from the video description", async () => {
      mockEnv.AI.run = vi.fn().mockResolvedValue({
        response: JSON.stringify({
          name: "Tomato Pasta",
          description: null,
          prepTime: null,
          cookTime: 15,
          totalTime: null,
          servings: 2,
          ingredientSections: [
            {
              name: null,
              ingredients: [
                { index: 0, quantity: 200, unit: "g", name: "spaghetti" },
                { index: 1, quantity: 1, unit: "cup", name: "tomato sauce" },
              ],
            },
          ],
          instructionSections: [
            {
              name: null,
              instructions: [
                { index: 0, instruction: "Boil the pasta." },
                { index: 1, instruction: "Toss with tomato sauce." },
              ],
            },
          ],
        }),
      });

      global.fetch = vi.fn((requestUrl: string | URL) => {
        const requested = String(requestUrl);
        if (
          requested.startsWith("https://www.googleapis.com/youtube/v3/videos")
        ) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                items: [
                  {
                    id: "abc123def45",
                    snippet: {
                      title: "Tomato pasta short",
                      description:
                        "Recipe: 200 g spaghetti, 1 cup tomato sauce. Boil pasta and toss with sauce.",
                      channelTitle: "Cook Channel",
                      channelId: "channel-1",
                      thumbnails: {
                        high: {
                          url: "https://example.com/youtube.jpg",
                          width: 480,
                        },
                      },
                    },
                    status: {
                      privacyStatus: "public",
                      uploadStatus: "processed",
                    },
                  },
                ],
              }),
          });
        }

        if (
          requested.startsWith(
            "https://www.googleapis.com/youtube/v3/commentThreads",
          )
        ) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ items: [] }),
          });
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve(
              "<script>var ytInitialPlayerResponse = {};</script>",
            ),
        });
      }) as any;

      const result = await parser.parse({
        type: "url",
        data: "https://www.youtube.com/watch?v=abc123def45",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Tomato Pasta");
        expect(result.data.images).toEqual([
          expect.stringMatching(
            /^https:\/\/images\.example\.com\/temp\/generated\/[a-zA-Z0-9-]+\.jpg$/,
          ),
        ]);
        expect(result.metadata.parseMethod).toBe("ai_only");
        expect(
          result.metadata.diagnostics?.stageTimings?.map((stage) => stage.name),
        ).toEqual(
          expect.arrayContaining([
            "youtube_metadata",
            "youtube_comments",
            "youtube_captions",
            "ai",
          ]),
        );
      }
    });

    it("retries YouTube social AI with Scout when the compact model returns malformed JSON", async () => {
      mockEnv.AI.run = vi
        .fn()
        .mockResolvedValueOnce({
          response:
            '{ "name": "Sheet Pan Chicken Kefta", "ingredientSections": [{ "name": "Chicken Kefta", "ingredients": [{ "index": 0, "quantity": 1.5, "unit": "lb", "name": "ground chicken", "pr',
        })
        .mockResolvedValueOnce({
          response: JSON.stringify({
            name: "Sheet Pan Chicken Kefta",
            description: null,
            prepTime: null,
            cookTime: 20,
            totalTime: null,
            servings: 4,
            ingredientSections: [
              {
                name: "Chicken Kefta",
                ingredients: [
                  {
                    index: 0,
                    quantity: 1.5,
                    unit: "lb",
                    name: "ground chicken",
                  },
                  {
                    index: 1,
                    quantity: 2,
                    unit: "tbsp",
                    name: "tomato paste",
                  },
                ],
              },
            ],
            instructionSections: [
              {
                name: null,
                instructions: [
                  {
                    index: 0,
                    instruction:
                      "Spread the chicken mixture on a sheet pan and bake.",
                  },
                ],
              },
            ],
            suggestedTags: ["dinner"],
          }),
        });

      global.fetch = vi.fn((requestUrl: string | URL) => {
        const requested = String(requestUrl);
        if (
          requested.startsWith("https://www.googleapis.com/youtube/v3/videos")
        ) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                items: [
                  {
                    id: "uWoB0_3wSrY",
                    snippet: {
                      title:
                        "Sheet Pan Chicken Kefta (Full recipe pinned in the comment section)",
                      description: "",
                      channelTitle: "Ben Chelin",
                      channelId: "channel-1",
                    },
                    status: {
                      privacyStatus: "public",
                      uploadStatus: "processed",
                    },
                  },
                ],
              }),
          });
        }

        if (
          requested.startsWith(
            "https://www.googleapis.com/youtube/v3/commentThreads",
          )
        ) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                items: [
                  {
                    snippet: {
                      topLevelComment: {
                        snippet: {
                          textOriginal:
                            "For the Chicken Kefta: 1.5 lb ground chicken, 2 tbsp tomato paste. Instructions: spread on a sheet pan and bake until cooked through.",
                          authorDisplayName: "Ben Chelin",
                          authorChannelId: { value: "channel-1" },
                          likeCount: 100,
                        },
                      },
                    },
                  },
                ],
              }),
          });
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve(
              "<script>var ytInitialPlayerResponse = {};</script>",
            ),
        });
      }) as any;

      const result = await parser.parse({
        type: "url",
        data: "https://youtube.com/shorts/uWoB0_3wSrY?si=test",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Sheet Pan Chicken Kefta");
        expect(result.metadata.parseMethod).toBe("ai_only");
        expect(
          result.metadata.diagnostics?.stageTimings?.map((stage) => [
            stage.name,
            stage.status,
          ]),
        ).toEqual(
          expect.arrayContaining([
            ["ai", "error"],
            ["ai_retry", "success"],
          ]),
        );
      }

      expect(mockEnv.AI.run).toHaveBeenCalledTimes(2);
      expect(mockEnv.AI.run.mock.calls[0]?.[0]).toBe(SOCIAL_TEXT_MODEL);
      expect(mockEnv.AI.run.mock.calls[1]?.[0]).toBe(
        "@cf/meta/llama-4-scout-17b-16e-instruct",
      );
    });

    it("rehosts YouTube social images through the shared generated-image path", async () => {
      const uploadFromUrl = vi.fn(
        async (_sourceUrl: string, destinationKey: string) => ({
          success: true,
          publicUrl: `https://images.example.com/${destinationKey}`,
          key: destinationKey,
        }),
      );

      (mockEnv as any).IMAGE_SERVICE = { uploadFromUrl };
      mockEnv.AI.run = vi.fn().mockResolvedValue({
        response: JSON.stringify({
          name: "Tomato Pasta",
          description: null,
          prepTime: null,
          cookTime: 15,
          totalTime: null,
          servings: 2,
          ingredientSections: [
            {
              name: null,
              ingredients: [
                { index: 0, quantity: 200, unit: "g", name: "spaghetti" },
                { index: 1, quantity: 1, unit: "cup", name: "tomato sauce" },
              ],
            },
          ],
          instructionSections: [
            {
              name: null,
              instructions: [
                { index: 0, instruction: "Boil the pasta." },
                { index: 1, instruction: "Toss with tomato sauce." },
              ],
            },
          ],
        }),
      });

      global.fetch = vi.fn((requestUrl: string | URL) => {
        const requested = String(requestUrl);
        if (
          requested.startsWith("https://www.googleapis.com/youtube/v3/videos")
        ) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                items: [
                  {
                    id: "abc123def45",
                    snippet: {
                      title: "Tomato pasta short",
                      description:
                        "Recipe: 200 g spaghetti, 1 cup tomato sauce. Boil pasta and toss with sauce.",
                      channelTitle: "Cook Channel",
                      channelId: "channel-1",
                      thumbnails: {
                        high: {
                          url: "https://example.com/youtube.jpg",
                          width: 480,
                        },
                      },
                    },
                    status: {
                      privacyStatus: "public",
                      uploadStatus: "processed",
                    },
                  },
                ],
              }),
          });
        }

        if (
          requested.startsWith(
            "https://www.googleapis.com/youtube/v3/commentThreads",
          )
        ) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ items: [] }),
          });
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve(
              "<script>var ytInitialPlayerResponse = {};</script>",
            ),
        });
      }) as any;

      const result = await parser.parse({
        type: "url",
        data: "https://www.youtube.com/watch?v=abc123def45",
      });

      expect(result.success).toBe(true);
      expect(uploadFromUrl).toHaveBeenCalledTimes(1);
      expect(uploadFromUrl).toHaveBeenCalledWith(
        "https://example.com/youtube.jpg",
        expect.stringMatching(/^temp\/generated\/[a-zA-Z0-9-]+\.jpg$/),
      );
      if (result.success) {
        expect(result.data.images).toEqual([
          expect.stringMatching(
            /^https:\/\/images\.example\.com\/temp\/generated\/[a-zA-Z0-9-]+\.jpg$/,
          ),
        ]);
      }
    });

    it("does not reupload YouTube images when no recipe evidence is found", async () => {
      const uploadFromUrl = vi.fn(
        async (_sourceUrl: string, destinationKey: string) => ({
          success: true,
          publicUrl: `https://images.example.com/${destinationKey}`,
          key: destinationKey,
        }),
      );

      (mockEnv as any).IMAGE_SERVICE = { uploadFromUrl };
      mockEnv.AI.run = vi.fn();

      global.fetch = vi.fn((requestUrl: string | URL) => {
        const requested = String(requestUrl);
        if (
          requested.startsWith("https://www.googleapis.com/youtube/v3/videos")
        ) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                items: [
                  {
                    id: "abc123def45",
                    snippet: {
                      title: "A tomato tasting short",
                      description:
                        "Behind the scenes kitchen video with plating notes and restaurant chatter.",
                      channelTitle: "Cook Channel",
                      channelId: "channel-1",
                      thumbnails: {
                        high: {
                          url: "https://example.com/youtube.jpg",
                          width: 480,
                        },
                      },
                    },
                    status: {
                      privacyStatus: "public",
                      uploadStatus: "processed",
                    },
                  },
                ],
              }),
          });
        }

        if (
          requested.startsWith(
            "https://www.googleapis.com/youtube/v3/commentThreads",
          )
        ) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                items: [
                  {
                    snippet: {
                      topLevelComment: {
                        snippet: {
                          textOriginal: "Looks great!",
                          authorDisplayName: "Viewer",
                        },
                      },
                    },
                  },
                ],
              }),
          });
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve(
              "<script>var ytInitialPlayerResponse = {};</script>",
            ),
        });
      }) as any;

      const result = await parser.parse({
        type: "url",
        data: "https://www.youtube.com/watch?v=abc123def45",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("YOUTUBE_NO_RECIPE_EVIDENCE");
      }
      expect(uploadFromUrl).not.toHaveBeenCalled();
      expect(mockEnv.AI.run).not.toHaveBeenCalled();
    });

    it("imports a linked recipe page from a YouTube creator comment before AI", async () => {
      const linkedRecipeUrl = "https://recipe.example.com/youtube-pasta";
      const linkedRecipeHtml = `
        <html>
          <head>
            <script type="application/ld+json">
              ${JSON.stringify({
                "@context": "https://schema.org",
                "@type": "Recipe",
                name: "Creator Comment Pasta",
                recipeIngredient: ["200 g spaghetti", "1 cup tomato sauce"],
                recipeInstructions: [
                  { "@type": "HowToStep", text: "Boil the spaghetti." },
                  { "@type": "HowToStep", text: "Toss with tomato sauce." },
                ],
              })}
            </script>
          </head>
          <body></body>
        </html>
      `;

      mockEnv.AI.run = vi.fn();
      global.fetch = vi.fn((requestUrl: string | URL) => {
        const requested = String(requestUrl);
        if (
          requested.startsWith("https://www.googleapis.com/youtube/v3/videos")
        ) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                items: [
                  {
                    id: "abc123def45",
                    snippet: {
                      title: "Tomato pasta",
                      description: "Full recipe is pinned in the comments.",
                      channelTitle: "Cook Channel",
                      channelId: "channel-1",
                    },
                    status: {
                      privacyStatus: "public",
                      uploadStatus: "processed",
                    },
                  },
                ],
              }),
          });
        }

        if (
          requested.startsWith(
            "https://www.googleapis.com/youtube/v3/commentThreads",
          )
        ) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                items: [
                  {
                    snippet: {
                      topLevelComment: {
                        snippet: {
                          textOriginal: `Full recipe here: ${linkedRecipeUrl}`,
                          authorDisplayName: "Cook Channel",
                          authorChannelId: { value: "channel-1" },
                          likeCount: 100,
                        },
                      },
                    },
                  },
                ],
              }),
          });
        }

        if (requested === linkedRecipeUrl) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ "content-type": "text/html" }),
            text: () => Promise.resolve(linkedRecipeHtml),
            arrayBuffer: () =>
              Promise.resolve(
                new TextEncoder().encode(linkedRecipeHtml).buffer,
              ),
          });
        }

        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: "Not Found",
        });
      }) as any;

      const result = await parser.parse({
        type: "url",
        data: "https://www.youtube.com/watch?v=abc123def45",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Creator Comment Pasta");
        expect(result.metadata.parseMethod).toBe("schema_org");
        expect(result.metadata.canonicalUrl).toBe(linkedRecipeUrl);
        expect(
          result.metadata.diagnostics?.stageTimings?.map((stage) => stage.name),
        ).toContain("linked_url");
      }
      expect(mockEnv.AI.run).not.toHaveBeenCalled();
    });

    it("uses YouTube captions for spoken recipe imports", async () => {
      mockEnv.AI.run = vi.fn().mockResolvedValue({
        response: JSON.stringify({
          name: "Spoken Pancakes",
          description: null,
          prepTime: null,
          cookTime: 10,
          totalTime: null,
          servings: 2,
          ingredientSections: [
            {
              name: null,
              ingredients: [
                { index: 0, quantity: 1, unit: "cup", name: "flour" },
                { index: 1, quantity: 1, unit: "cup", name: "milk" },
              ],
            },
          ],
          instructionSections: [
            {
              name: null,
              instructions: [
                { index: 0, instruction: "Whisk the batter." },
                { index: 1, instruction: "Cook the pancakes." },
              ],
            },
          ],
        }),
      });

      global.fetch = vi.fn((requestUrl: string | URL) => {
        const requested = String(requestUrl);
        if (
          requested.startsWith("https://www.googleapis.com/youtube/v3/videos")
        ) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                items: [
                  {
                    id: "abc123def45",
                    snippet: {
                      title: "Pancakes from scratch",
                      description: "Recipe is spoken in the video.",
                      channelTitle: "Cook Channel",
                      channelId: "channel-1",
                    },
                    status: {
                      privacyStatus: "public",
                      uploadStatus: "processed",
                    },
                  },
                ],
              }),
          });
        }

        if (
          requested.startsWith(
            "https://www.googleapis.com/youtube/v3/commentThreads",
          )
        ) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ items: [] }),
          });
        }

        if (requested === "https://www.youtube.com/watch?v=abc123def45") {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: () =>
              Promise.resolve(`
                <script>
                  var ytInitialPlayerResponse = ${JSON.stringify({
                    captions: {
                      playerCaptionsTracklistRenderer: {
                        captionTracks: [
                          { baseUrl: "https://captions.example.com/track" },
                        ],
                      },
                    },
                  })};
                </script>
              `),
          });
        }

        if (requested.startsWith("https://captions.example.com/track")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  events: [
                    { segs: [{ utf8: "Use 1 cup flour and 1 cup milk. " }] },
                    { segs: [{ utf8: "Whisk the batter and cook pancakes." }] },
                  ],
                }),
              ),
          });
        }

        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: "Not Found",
        });
      }) as any;

      const result = await parser.parse({
        type: "url",
        data: "https://www.youtube.com/watch?v=abc123def45",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Spoken Pancakes");
        expect(result.metadata.parseMethod).toBe("media_enriched");
      }
      expect(JSON.stringify(mockEnv.AI.run.mock.calls)).toContain(
        "Audio transcript:",
      );
      expect(JSON.stringify(mockEnv.AI.run.mock.calls)).toContain(
        "Use 1 cup flour",
      );
    });

    it("fails spoken-only YouTube videos when no transcript is usable", async () => {
      mockEnv.AI.run = vi.fn();
      global.fetch = vi.fn((requestUrl: string | URL) => {
        const requested = String(requestUrl);
        if (
          requested.startsWith("https://www.googleapis.com/youtube/v3/videos")
        ) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                items: [
                  {
                    id: "abc123def45",
                    snippet: {
                      title: "Pancakes from scratch",
                      description: "Recipe is spoken in the video.",
                      channelTitle: "Cook Channel",
                      channelId: "channel-1",
                    },
                    status: {
                      privacyStatus: "public",
                      uploadStatus: "processed",
                    },
                  },
                ],
              }),
          });
        }

        if (
          requested.startsWith(
            "https://www.googleapis.com/youtube/v3/commentThreads",
          )
        ) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ items: [] }),
          });
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve(
              "<script>var ytInitialPlayerResponse = {};</script>",
            ),
        });
      }) as any;

      const result = await parser.parse({
        type: "url",
        data: "https://www.youtube.com/watch?v=abc123def45",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("YOUTUBE_NO_RECIPE_EVIDENCE");
      }
      expect(mockEnv.AI.run).not.toHaveBeenCalled();
    });

    it("continues YouTube parsing when comments are disabled", async () => {
      mockEnv.AI.run = vi.fn().mockResolvedValue({
        response: JSON.stringify({
          name: "No Comment Pasta",
          description: null,
          prepTime: null,
          cookTime: 15,
          totalTime: null,
          servings: 2,
          ingredientSections: [
            {
              name: null,
              ingredients: [
                { index: 0, quantity: 200, unit: "g", name: "spaghetti" },
                { index: 1, quantity: 1, unit: "cup", name: "tomato sauce" },
              ],
            },
          ],
          instructionSections: [
            {
              name: null,
              instructions: [{ index: 0, instruction: "Boil and toss." }],
            },
          ],
        }),
      });

      global.fetch = vi.fn((requestUrl: string | URL) => {
        const requested = String(requestUrl);
        if (
          requested.startsWith("https://www.googleapis.com/youtube/v3/videos")
        ) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                items: [
                  {
                    id: "abc123def45",
                    snippet: {
                      title: "No comment pasta",
                      description:
                        "Ingredients: 200 g spaghetti, 1 cup tomato sauce. Instructions: boil and toss.",
                      channelTitle: "Cook Channel",
                      channelId: "channel-1",
                    },
                    status: {
                      privacyStatus: "public",
                      uploadStatus: "processed",
                    },
                  },
                ],
              }),
          });
        }

        if (
          requested.startsWith(
            "https://www.googleapis.com/youtube/v3/commentThreads",
          )
        ) {
          return Promise.resolve({
            ok: false,
            status: 403,
            json: () =>
              Promise.resolve({
                error: { message: "The video has comments disabled." },
              }),
          });
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve(
              "<script>var ytInitialPlayerResponse = {};</script>",
            ),
        });
      }) as any;

      const result = await parser.parse({
        type: "url",
        data: "https://www.youtube.com/watch?v=abc123def45",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("No Comment Pasta");
        expect(
          result.metadata.diagnostics?.stageTimings?.find(
            (stage) => stage.name === "youtube_comments",
          )?.status,
        ).toBe("skipped");
      }
    });

    it("fails unavailable YouTube videos clearly", async () => {
      mockEnv.AI.run = vi.fn();
      global.fetch = vi.fn((requestUrl: string | URL) => {
        const requested = String(requestUrl);
        if (
          requested.startsWith("https://www.googleapis.com/youtube/v3/videos")
        ) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                items: [
                  {
                    id: "abc123def45",
                    snippet: { title: "Private video" },
                    status: {
                      privacyStatus: "private",
                      uploadStatus: "processed",
                    },
                  },
                ],
              }),
          });
        }

        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: "Not Found",
        });
      }) as any;

      const result = await parser.parse({
        type: "url",
        data: "https://www.youtube.com/watch?v=abc123def45",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("YOUTUBE_METADATA_FAILED");
        expect(result.error.message).toContain("not available");
      }
      expect(mockEnv.AI.run).not.toHaveBeenCalled();
    });

    it("rejects social links during structured-only basic import without fetching", async () => {
      const result = await parser.parse({
        type: "url",
        data: "https://www.youtube.com/watch?v=abc123",
        structuredOnly: true,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("UNSUPPORTED_URL");
      }
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("evicts unusable cached recipes and retries live parsing", async () => {
      const cachedRecipe = {
        name: "Stale Recipe",
        ingredientSections: [],
        instructionSections: [],
      };

      mockEnv.RECIPE_CACHE.get = vi.fn().mockResolvedValue(cachedRecipe);
      (mockEnv.RECIPE_CACHE as any).delete = vi
        .fn()
        .mockResolvedValue(undefined);

      const result = await parser.parse({
        type: "url",
        data: "https://example.com/stale-cache",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Recipe Title");
        expect(result.metadata.cached).toBe(false);
      }
      expect((mockEnv.RECIPE_CACHE as any).delete).toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalled();
    });

    it("includes TikTok subtitle transcripts in the AI parse", async () => {
      const tiktokCaption =
        "fudgy browniess recipe by Handle the Heat: 5 tbsp butter 1 1/4 cups sugar 2 eggs plus 1 egg yolk #brownies";
      const hydration = {
        __DEFAULT_SCOPE__: {
          "webapp.reflow.video.detail": {
            itemInfo: {
              itemStruct: {
                desc: tiktokCaption,
                video: {
                  cover: "https://example.com/tiktok.jpg",
                  subtitleInfos: [
                    {
                      Url: "https://subtitle.example.com/brownies.vtt",
                      Format: "webvtt",
                      Source: "ASR",
                    },
                  ],
                },
              },
            },
          },
        },
      };
      const invalidAiRecipe = {
        name: "Fudgy Brownies",
        description: null,
        prepTime: null,
        cookTime: null,
        totalTime: null,
        servings: null,
        ingredientSections: [
          {
            name: null,
            ingredients: [
              { index: 0, quantity: 5, unit: "tbsp", name: "butter" },
              { index: 1, quantity: 1.25, unit: "cup", name: "sugar" },
            ],
          },
        ],
        instructionSections: [],
        suggestedTags: [],
      };
      const enrichedAiRecipe = {
        ...invalidAiRecipe,
        instructionSections: [
          {
            name: null,
            instructions: [
              {
                index: 0,
                instruction: "Whisk melted butter and sugar together.",
              },
              {
                index: 1,
                instruction: "Bake the brownies for 40 minutes.",
              },
            ],
          },
        ],
        suggestedTags: [],
      };

      const recipeExtractionRequests: Record<string, unknown>[] = [];
      mockEnv.AI.run = vi.fn(
        (model: string, request: Record<string, unknown>) => {
          if (model === SOCIAL_TEXT_MODEL) {
            recipeExtractionRequests.push(request);
          }

          return Promise.resolve({
            response: JSON.stringify(enrichedAiRecipe),
          });
        },
      );

      global.fetch = vi.fn((requestUrl: string | URL) => {
        const url = String(requestUrl);
        if (url.startsWith("https://www.tiktok.com/oembed")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ "content-type": "application/json" }),
            json: () =>
              Promise.resolve({
                title: tiktokCaption,
                thumbnail_url: "https://example.com/tiktok.jpg",
              }),
          });
        }

        if (
          url ===
          "https://www.tiktok.com/@thelittlecakela/video/7208369840007007531"
        ) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: () =>
              Promise.resolve(`
                <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">
                  ${JSON.stringify(hydration)}
                </script>
              `),
          });
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve(`
WEBVTT

00:00:00.000 --> 00:00:01.000
Whisk melted butter and sugar together.

00:00:01.001 --> 00:00:02.000
Bake the brownies for 40 minutes.
            `),
        });
      }) as any;

      const result = await parser.parse({
        type: "url",
        data: "https://www.tiktok.com/@thelittlecakela/video/7208369840007007531",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.instructionSections[0]?.instructions).toHaveLength(
          2,
        );
        expect(result.metadata.parseMethod).toBe("media_enriched");
      }
      expect(recipeExtractionRequests).toHaveLength(1);
      expect(JSON.stringify(recipeExtractionRequests[0])).toContain(
        "Audio transcript:",
      );
      expect(JSON.stringify(recipeExtractionRequests[0])).toContain(
        "Whisk melted butter and sugar together.",
      );
    });

    it("caches successful results", async () => {
      const result = await parser.parse({
        type: "url",
        data: "https://example.com/recipe",
      });

      expect(result.success).toBe(true);
      expect(mockEnv.RECIPE_CACHE.put).toHaveBeenCalled();
    });

    it("returns error on fetch failure", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        headers: new Headers({ "content-type": "text/html" }),
      });

      const result = await parser.parse({
        type: "url",
        data: "https://example.com/404",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("FETCH_FAILED");
      }
    });

    it("does not report short-link resolution network failures as invalid URLs", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      vi.spyOn(console, "log").mockImplementation(() => undefined);
      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      const result = await parser.parse({
        type: "url",
        data: "https://bit.ly/example-recipe",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("FETCH_FAILED");
      }
    });

    it("uses reader fallback when regular fetch is blocked", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      vi.spyOn(console, "log").mockImplementation(() => undefined);
      const readerMarkdown = `
Markdown Content:
This reader fallback cake is reliable and easy to make.

Serves 4

### Ingredients

*   2 cups flour
*   1 cup sugar

### Instructions

1.   Mix the ingredients.
2.   Bake until golden.
      `;

      global.fetch = vi.fn((requestUrl: string | URL) => {
        if (String(requestUrl).startsWith("https://r.jina.ai/")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ "content-type": "text/plain" }),
            text: () => Promise.resolve(readerMarkdown),
          });
        }

        return Promise.resolve({
          ok: false,
          status: 403,
          statusText: "Forbidden",
          headers: new Headers({ "content-type": "text/html" }),
        });
      }) as any;

      const result = await parser.parse({
        type: "url",
        data: "https://example.com/reader-fallback-cake-recipe-123",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Reader Fallback Cake");
        expect(result.metadata.parseMethod).toBe("reader");
        expect(mockEnv.AI.run).not.toHaveBeenCalled();
      }
    });

    it("returns error when page has no content", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        arrayBuffer: () =>
          Promise.resolve(
            new TextEncoder().encode("<html><body></body></html>").buffer,
          ),
        text: () => Promise.resolve("<html><body></body></html>"),
      });

      const result = await parser.parse({
        type: "url",
        data: "https://example.com/empty",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NO_CONTENT");
      }
    });
  });

  describe("text parsing flow", () => {
    it("parses recipe from text using AI", async () => {
      const result = await parser.parse({
        type: "text",
        data: "Here is my recipe: Chocolate Cake. Ingredients: 2 cups flour, 1 cup sugar. Instructions: Mix and bake.",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Test Recipe");
        expect(result.metadata.source).toBe("text");
        expect(
          result.metadata.diagnostics?.stageTimings?.map((stage) => stage.name),
        ).toEqual(expect.arrayContaining(["ai", "image_rehosting"]));
        expect(mockEnv.AI.run).toHaveBeenCalled();
      }
    });

    it("returns error for text too short", async () => {
      const result = await parser.parse({
        type: "text",
        data: "Too short",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_INPUT");
        expect(result.metadata?.source).toBe("text");
        expect(result.metadata?.diagnostics?.totalElapsedMs).toEqual(
          expect.any(Number),
        );
        expect(
          result.metadata?.diagnostics?.stageTimings?.some(
            (stage) =>
              stage.name === "image_rehosting" && stage.status === "skipped",
          ),
        ).toBe(true);
      }
    });

    it("returns error for text too long", async () => {
      const longText = "A".repeat(15000);
      const result = await parser.parse({
        type: "text",
        data: longText,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INPUT_TOO_LONG");
      }
    });
  });

  describe("image parsing flow", () => {
    it("parses recipe from image using AI", async () => {
      const base64Image = btoa("fake image data that is long enough");

      const result = await parser.parse({
        type: "image",
        data: base64Image,
        mimeType: "image/jpeg",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Test Recipe");
        expect(result.metadata.source).toBe("image");
        expect(
          result.metadata.diagnostics?.stageTimings?.map((stage) => stage.name),
        ).toEqual(expect.arrayContaining(["ai", "image_rehosting"]));
      }
    });

    it("counts the uploaded source image before image recipe quality scoring", async () => {
      (mockEnv as any).IMAGE_SERVICE = {
        uploadImage: vi.fn().mockResolvedValue({
          success: true,
          publicUrl: "https://images.example.com/source.jpg",
        }),
      };
      mockEnv.AI.run = vi.fn().mockResolvedValue({
        response: JSON.stringify({
          name: "Toast Plate",
          description: null,
          prepTime: null,
          cookTime: null,
          totalTime: null,
          servings: null,
          ingredientSections: [
            {
              name: null,
              ingredients: [
                { index: 0, quantity: 2, unit: "slices", name: "bread" },
                { index: 1, quantity: 1, unit: "tbsp", name: "butter" },
                { index: 2, quantity: 1, unit: "pinch", name: "salt" },
              ],
            },
          ],
          instructionSections: [
            {
              name: null,
              instructions: [
                { index: 0, instruction: "Toast the bread." },
                { index: 1, instruction: "Butter and season it." },
              ],
            },
          ],
        }),
      });

      const result = await parser.parse({
        type: "image",
        data: btoa("fake image data that is long enough"),
        mimeType: "image/jpeg",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.images).toEqual([
          "https://images.example.com/source.jpg",
        ]);
      }
    });

    it("returns error for invalid mime type", async () => {
      const result = await parser.parse({
        type: "image",
        data: btoa("image"),
        mimeType: "image/gif" as any,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_MIME_TYPE");
      }
    });

    it("returns error for invalid base64", async () => {
      const result = await parser.parse({
        type: "image",
        data: "not-valid-base64!!!",
        mimeType: "image/jpeg",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_BASE64");
      }
    });

    it("accepts PNG images", async () => {
      const result = await parser.parse({
        type: "image",
        data: btoa("fake png data"),
        mimeType: "image/png",
      });

      expect(result.success).toBe(true);
    });

    it("accepts WebP images", async () => {
      const result = await parser.parse({
        type: "image",
        data: btoa("fake webp data"),
        mimeType: "image/webp",
      });

      expect(result.success).toBe(true);
    });
  });

  describe("error handling", () => {
    it("returns error for invalid input type", async () => {
      const result = await parser.parse({
        type: "invalid" as any,
        data: "test",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_INPUT_TYPE");
      }
    });

    it("catches and returns AI errors gracefully", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      vi.spyOn(console, "log").mockImplementation(() => undefined);
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        arrayBuffer: () =>
          Promise.resolve(new TextEncoder().encode(aiOnlyHtml).buffer),
        text: () => Promise.resolve(aiOnlyHtml),
      });
      mockEnv.AI.run = vi.fn().mockRejectedValue(new Error("AI service down"));

      const result = await parser.parse({
        type: "url",
        data: "https://example.com/recipe",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("AI_PARSE_FAILED");
      }
    });
  });

  describe("metadata accuracy", () => {
    it("reports medium confidence for AI-parsed URLs", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        arrayBuffer: () =>
          Promise.resolve(new TextEncoder().encode(aiOnlyHtml).buffer),
        text: () => Promise.resolve(aiOnlyHtml),
      });

      const result = await parser.parse({
        type: "url",
        data: "https://example.com/recipe",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.metadata.confidence).toBe("medium");
        expect(result.metadata.parseMethod).toBe("ai_only");
      }
    });

    it("reports correct source for each input type", async () => {
      const urlResult = await parser.parse({
        type: "url",
        data: "https://example.com",
      });
      expect(urlResult.success).toBe(true);
      if (urlResult.success) {
        expect(urlResult.metadata.source).toBe("url");
      }

      const textResult = await parser.parse({
        type: "text",
        data: "A recipe with enough content to be parsed properly by the system",
      });
      expect(textResult.success).toBe(true);
      if (textResult.success) {
        expect(textResult.metadata.source).toBe("text");
      }

      const imageResult = await parser.parse({
        type: "image",
        data: btoa("image data"),
        mimeType: "image/jpeg",
      });
      expect(imageResult.success).toBe(true);
      if (imageResult.success) {
        expect(imageResult.metadata.source).toBe("image");
      }
    });
  });
});

describe("RecipeAI.nutrition()", () => {
  let mockEnv: ReturnType<typeof createMockEnv>;
  let parser: RecipeAI;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockEnv = createMockEnv();
    parser = createParser(mockEnv);
  });

  it("generates nutrition with AI when no nutrition exists", async () => {
    mockEnv.AI.run = vi.fn().mockResolvedValue({
      response: JSON.stringify({
        calories: 510,
        protein: 14,
        carbohydrates: 82,
        fat: 15,
        saturatedFat: 2,
        fiber: 5,
        sugar: 8,
        sodium: 420,
        cholesterol: null,
        potassium: null,
        vitaminA: null,
        vitaminC: null,
        calcium: null,
        iron: null,
        confidence: "medium",
      }),
    });

    const result = await parser.nutrition({
      recipe: recipeWithoutNutrition,
      sourceUrl: null,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        calories: 510,
        protein: 14,
        carbohydrates: 82,
        fat: 15,
        source: "ai_estimated",
        confidence: "medium",
      });
    }

    expect(mockEnv.AI.run).toHaveBeenCalledTimes(1);
    const request = mockEnv.AI.run.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(request).not.toHaveProperty("response_format");
    expect(JSON.stringify(request)).toContain("per serving");
    expect(JSON.stringify(request)).toContain("not for the whole recipe");
  });

  it("generates nutrition in one plain JSON AI request", async () => {
    mockEnv.AI.run = vi.fn().mockResolvedValue({
      response: JSON.stringify({
        kcal: "530 kcal",
        protein_g: "22 g",
        carbs_g: "65 g",
        total_fat: "17 g",
        confidence: "low",
      }),
    });

    const result = await parser.nutrition({
      recipe: recipeWithoutNutrition,
      sourceUrl: null,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        calories: 530,
        protein: 22,
        carbohydrates: 65,
        fat: 17,
        source: "ai_estimated",
        confidence: "low",
      });
    }

    expect(mockEnv.AI.run).toHaveBeenCalledTimes(1);
    const request = mockEnv.AI.run.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(request).not.toHaveProperty("response_format");
  });

  it("fills missing core fields when existing imported nutrition is partial", async () => {
    mockEnv.AI.run = vi.fn().mockResolvedValue({
      response: JSON.stringify({
        calories: 600,
        protein: 20,
        carbohydrates: 64,
        fat: 22,
        saturatedFat: 6,
        fiber: 8,
        sugar: 10,
        sodium: 520,
        confidence: "medium",
      }),
    });

    const result = await parser.nutrition({
      recipe: {
        ...recipeWithoutNutrition,
        nutrition: {
          calories: 450,
          protein: 12,
          source: "imported",
          confidence: "high",
        },
      },
      sourceUrl: null,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        calories: 450,
        protein: 12,
        carbohydrates: 64,
        fat: 22,
        saturatedFat: 6,
        fiber: 8,
        sugar: 10,
        sodium: 520,
        source: "ai_estimated",
        confidence: "medium",
      });
    }

    expect(mockEnv.AI.run).toHaveBeenCalledTimes(1);
    const request = mockEnv.AI.run.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(JSON.stringify(request)).toContain("Known per-serving nutrition");
    expect(JSON.stringify(request)).toContain('\\"calories\\":450');
  });

  it("returns existing nutrition without AI when core fields are complete", async () => {
    const result = await parser.nutrition({
      recipe: {
        ...recipeWithoutNutrition,
        nutrition: {
          calories: 450,
          protein: 12,
          carbohydrates: 60,
          fat: 18,
          source: "imported",
          confidence: "high",
        },
      },
      sourceUrl: null,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        calories: 450,
        protein: 12,
        carbohydrates: 60,
        fat: 18,
        source: "imported",
        confidence: "high",
      });
    }

    expect(mockEnv.AI.run).not.toHaveBeenCalled();
  });
});

describe("default HTTP handler", () => {
  it("returns error response for direct HTTP access", async () => {
    const { default: handler } = await import("../../src/index");
    const mockRequest = new Request("https://example.com/");
    const mockEnv = { AI: {}, RECIPE_CACHE: {} } as any;
    const response = await handler.fetch(mockRequest, mockEnv);

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("RPC");
  });
});
