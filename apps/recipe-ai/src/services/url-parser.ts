import type { ParsedRecipe } from "../schema";
import { ParsedRecipeSchema } from "../schema";
import type { Env, ParseResult } from "../types";
import { parseRecipeFromHtml, repairRecipeFromEvidence } from "./ai-client";
import { deleteCachedRecipe, getCachedRecipe } from "./cache";
import { aiResultToRecipe } from "./recipe-mapper";
import { parseSocialUrl } from "./social-url-parser";
import { createSourceSnapshot } from "./source-snapshot";
import {
  evaluateRecipeCandidates,
  type RecipeCandidate,
  selectBestRecipeCandidate,
} from "./url-parse-utils";
import {
  discoverAlternateRecipeUrls,
  getWordPressRestPostUrl,
} from "../utils/alternate-pages";
import {
  requiresBrowserRendering,
  fetchHtmlWithBrowser,
} from "../utils/browser-fetcher";
import {
  cleanHtml,
  extractImageUrls,
  extractStepImageContext,
  focusRecipeContent,
} from "../utils/html-cleaner";
import {
  fetchHtml,
  isLikelyBotBlockedError,
  readLimitedText,
} from "../utils/html-fetcher";
import {
  appendFallbackPath,
  recordDiagnosticsStage,
} from "../utils/parse-diagnostics";
import { fetchReaderMarkdown } from "../utils/reader-fetcher";
import { extractRecipeOutline } from "../utils/recipe-outline-parser";
import {
  evaluateRecipeQuality,
  mergeRecipeImages,
  normalizeRecipeForImport,
} from "../utils/recipe-quality";
import { extractStructuredRecipeCandidates } from "../utils/structured-data";
import {
  extractMarkdownRecipeCard,
  extractVisibleRecipeCard,
} from "../utils/visible-recipe-card";

export interface ParseUrlOptions {
  /** If true, only use structured data extraction (no AI). For Basic Import. */
  structuredOnly?: boolean;
  /** Internal guard: linked-page fallbacks should not recursively parse social URLs. */
  allowSocial?: boolean;
}

async function collectReaderCandidates(
  url: string,
): Promise<RecipeCandidate[]> {
  const startTime = Date.now();
  try {
    const markdown = await fetchReaderMarkdown(url);
    const markdownRecipe = extractMarkdownRecipeCard(markdown, url);
    const outlineRecipe = extractRecipeOutline(markdown, {
      sourceUrl: url,
      sourceType: "url",
      images: markdownRecipe?.images ?? [],
    });

    return [
      {
        recipe: markdownRecipe,
        source: "reader",
        parseMethod: "reader",
        elapsedMs: elapsed(startTime),
        evidence: {
          imageCount: markdownRecipe?.images?.length ?? 0,
          textLength: markdown.length,
          sourceUrl: url,
        },
      },
      {
        recipe: outlineRecipe,
        source: "reader",
        parseMethod: "outline_rules",
        elapsedMs: elapsed(startTime),
        evidence: {
          imageCount: outlineRecipe?.images?.length ?? 0,
          textLength: markdown.length,
          sourceUrl: url,
        },
      },
    ];
  } catch (error) {
    console.log(
      "Reader fallback failed:",
      error instanceof Error ? error.message : error,
    );
    return [
      {
        recipe: null,
        source: "reader",
        parseMethod: "reader",
        elapsedMs: elapsed(startTime),
        evidence: { sourceUrl: url },
        error,
      },
    ];
  }
}

function elapsed(startTime: number): number {
  return Math.max(0, Date.now() - startTime);
}

function withOriginalSourceUrl(
  recipe: ParsedRecipe | null,
  sourceUrl: string,
): ParsedRecipe | null {
  return recipe ? { ...recipe, sourceUrl } : null;
}

function structuredRecipeCandidates(
  html: string,
  htmlUrl: string,
  sourceUrl: string,
  imageUrls: string[],
): RecipeCandidate[] {
  return extractStructuredRecipeCandidates(html, htmlUrl).map((recipe) => ({
    recipe: mergeRecipeImages({ ...recipe, sourceUrl }, imageUrls),
    source: "structured",
    parseMethod: "schema_org",
    evidence: {
      imageCount: recipe.images?.length ?? imageUrls.length,
      sourceUrl: htmlUrl,
    },
  }));
}

function deterministicHtmlCandidates(
  html: string,
  htmlUrl: string,
  sourceUrl: string,
): RecipeCandidate[] {
  const imageUrls = extractImageUrls(html, htmlUrl);
  const visibleRecipe = withOriginalSourceUrl(
    extractVisibleRecipeCard(html, htmlUrl),
    sourceUrl,
  );
  const focusedText = focusRecipeContent(cleanHtml(html), 12_000);
  const outlineRecipe = extractRecipeOutline(focusedText, {
    sourceUrl,
    sourceType: "url",
    images: imageUrls,
  });

  return [
    ...structuredRecipeCandidates(html, htmlUrl, sourceUrl, imageUrls),
    {
      recipe: visibleRecipe
        ? mergeRecipeImages(visibleRecipe, imageUrls)
        : null,
      source: "visible",
      parseMethod: "visible_card",
      evidence: {
        imageCount: imageUrls.length,
        sourceUrl: htmlUrl,
      },
    },
    {
      recipe: outlineRecipe,
      source: "reader",
      parseMethod: "outline_rules",
      evidence: {
        imageCount: imageUrls.length,
        textLength: focusedText.length,
        sourceUrl: htmlUrl,
      },
    },
  ];
}

async function collectAlternateRecipePageCandidates(
  sourceUrl: string,
  html: string,
): Promise<RecipeCandidate[]> {
  const alternateUrls = discoverAlternateRecipeUrls(html, sourceUrl);
  const candidates: RecipeCandidate[] = [];

  for (const alternateUrl of alternateUrls) {
    const startTime = Date.now();
    try {
      const alternateHtml = await fetchHtml(alternateUrl, 0);
      candidates.push(
        ...deterministicHtmlCandidates(
          alternateHtml,
          alternateUrl,
          sourceUrl,
        ).map((candidate) => ({
          ...candidate,
          id: `alternate-${candidate.parseMethod ?? candidate.source}-${candidates.length + 1}`,
          elapsedMs: elapsed(startTime),
          evidence: {
            ...candidate.evidence,
            sourceUrl: alternateUrl,
          },
        })),
      );
    } catch (error) {
      console.log(
        "Alternate recipe page failed:",
        error instanceof Error ? error.message : error,
      );
      candidates.push({
        recipe: null,
        source: "reader",
        parseMethod: "reader",
        elapsedMs: elapsed(startTime),
        evidence: { sourceUrl: alternateUrl },
        error,
      });
    }
  }

  return candidates;
}

interface WordPressRestPost {
  content?: { rendered?: string };
  excerpt?: { rendered?: string };
  title?: { rendered?: string };
  yoast_head_json?: {
    schema?: unknown;
    og_image?: { url?: string }[];
  };
}

function wordPressPostToHtml(post: WordPressRestPost): string | null {
  const content = post.content?.rendered;
  if (!content) return null;

  const title = post.title?.rendered ?? "";
  const excerpt = post.excerpt?.rendered ?? "";
  const schema = post.yoast_head_json?.schema;
  const ogImage = post.yoast_head_json?.og_image?.[0]?.url;
  const schemaScript = schema
    ? `<script type="application/ld+json">${JSON.stringify(schema)}</script>`
    : "";
  const imageMeta = ogImage
    ? `<meta property="og:image" content="${ogImage}">`
    : "";

  return `
    <html>
      <head>${schemaScript}${imageMeta}</head>
      <body>
        <article>
          <h1>${title}</h1>
          ${excerpt}
          ${content}
        </article>
      </body>
    </html>
  `;
}

async function fetchWordPressRestHtml(restUrl: string): Promise<string | null> {
  const response = await fetch(restUrl, {
    signal: AbortSignal.timeout(8_000),
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) return null;

  const data: unknown =
    !response.body &&
    typeof (response as { json?: () => Promise<unknown> }).json === "function"
      ? await (response as { json: () => Promise<unknown> }).json()
      : JSON.parse(await readLimitedText(response, 512 * 1024));
  const post = Array.isArray(data) ? data[0] : data;
  if (!post || typeof post !== "object") return null;

  return wordPressPostToHtml(post as WordPressRestPost);
}

async function collectWordPressRestCandidates(
  sourceUrl: string,
  html: string,
): Promise<RecipeCandidate[]> {
  const restUrl = getWordPressRestPostUrl(html, sourceUrl);
  if (!restUrl) return [];

  const startTime = Date.now();
  try {
    const restHtml = await fetchWordPressRestHtml(restUrl);
    if (!restHtml) return [];

    return deterministicHtmlCandidates(restHtml, sourceUrl, sourceUrl).map(
      (candidate) => ({
        ...candidate,
        id: `wordpress-${candidate.parseMethod ?? candidate.source}`,
        elapsedMs: elapsed(startTime),
        evidence: {
          ...candidate.evidence,
          sourceUrl: restUrl,
        },
      }),
    );
  } catch (error) {
    console.log(
      "WordPress REST fallback failed:",
      error instanceof Error ? error.message : error,
    );
    return [
      {
        recipe: null,
        source: "reader",
        parseMethod: "reader",
        elapsedMs: elapsed(startTime),
        evidence: { sourceUrl: restUrl },
        error,
      },
    ];
  }
}

function bestPartialCandidate(
  candidates: RecipeCandidate[],
): ParsedRecipe | null {
  const partials = candidates
    .map((candidate) => {
      if (!candidate.recipe) return null;
      const normalized = normalizeRecipeForImport(candidate.recipe);
      if (ParsedRecipeSchema(normalized) instanceof Error) return null;

      return {
        recipe: normalized,
        quality: evaluateRecipeQuality(normalized, candidate.source),
      };
    })
    .filter(
      (
        partial,
      ): partial is {
        recipe: ParsedRecipe;
        quality: ReturnType<typeof evaluateRecipeQuality>;
      } => Boolean(partial),
    )
    .sort((a, b) => b.quality.score - a.quality.score);

  return partials[0]?.recipe ?? null;
}

/**
 * Parse a recipe from a URL
 *
 * Strategy:
 * 1. Check cache
 * 2. Fetch HTML (using browser rendering for JS-heavy sites)
 * 3. Try structured data extraction (JSON-LD, microdata)
 * 4. If structuredOnly: return error if no structured data
 * 5. Otherwise: return usable structured data or extract with AI
 * 6. Cache successful result
 */
export async function parseUrl(
  env: Env,
  url: string,
  options?: ParseUrlOptions,
): Promise<ParseResult> {
  const { structuredOnly = false, allowSocial = true } = options ?? {};
  let sourceSnapshot: Awaited<ReturnType<typeof createSourceSnapshot>>;
  const sourceSnapshotStart = Date.now();
  try {
    sourceSnapshot = await createSourceSnapshot(url);
  } catch (error) {
    return {
      success: false,
      error: {
        code: "INVALID_URL",
        message: error instanceof Error ? error.message : "Invalid recipe URL",
      },
      metadata: {
        source: "url",
        confidence: "low",
        diagnostics: recordDiagnosticsStage(
          { originalUrl: url },
          "source_snapshot",
          sourceSnapshotStart,
          "error",
          error instanceof Error ? error.message : "invalid_url",
        ),
      },
    };
  }

  const sourceUrl = sourceSnapshot.canonicalUrl;
  const socialPlatform = sourceSnapshot.platform;

  if (structuredOnly && socialPlatform) {
    return {
      success: false,
      error: {
        code: "UNSUPPORTED_URL",
        message:
          "Social media links don't contain structured recipe data. They require AI-powered Smart Import.",
      },
      metadata: {
        source: "url",
        confidence: "low",
        canonicalUrl: sourceUrl,
        diagnostics: sourceSnapshot.diagnostics,
      },
    };
  }

  if (socialPlatform) {
    if (!allowSocial) {
      return {
        success: false,
        error: {
          code: "UNSUPPORTED_URL",
          message: "Linked social media URLs are not valid recipe pages.",
        },
        metadata: {
          source: "url",
          confidence: "low",
          canonicalUrl: sourceUrl,
          diagnostics: sourceSnapshot.diagnostics,
        },
      };
    }

    return parseSocialUrl(env, sourceUrl, socialPlatform, {
      diagnostics: sourceSnapshot.diagnostics,
      parseLinkedRecipeUrl: (linkedUrl) =>
        parseUrl(env, linkedUrl, { allowSocial: false }),
    });
  }

  let diagnostics = recordDiagnosticsStage(
    sourceSnapshot.diagnostics,
    "source_snapshot",
    sourceSnapshotStart,
    "success",
    sourceSnapshot.originalUrl === sourceUrl ? undefined : "canonicalized",
  );

  const cacheStart = Date.now();
  const cached = await getCachedRecipe(env.RECIPE_CACHE, sourceUrl);
  diagnostics = recordDiagnosticsStage(
    diagnostics,
    "cache",
    cacheStart,
    "success",
    cached ? "hit" : "miss",
  );
  if (cached) {
    const normalizedCached = normalizeRecipeForImport(cached);
    const validation = ParsedRecipeSchema(normalizedCached);
    const quality = evaluateRecipeQuality(normalizedCached, "cached");

    if (!(validation instanceof Error) && quality.usable) {
      return {
        success: true,
        data: normalizedCached,
        metadata: {
          source: "url",
          confidence: quality.confidence,
          cached: true,
          canonicalUrl: sourceUrl,
          diagnostics: {
            ...diagnostics,
            selectedAttempt: "cached",
            qualityScore: quality.score,
            attempts: [
              {
                id: "cached",
                method: "cached",
                source: "cached",
                status: "accepted",
                score: quality.score,
                confidence: quality.confidence,
                reasons: quality.reasons,
                ingredientCount: quality.ingredientCount,
                instructionCount: quality.instructionCount,
              },
            ],
          },
        },
      };
    }

    console.log("Cached recipe rejected; retrying live parse:", {
      score: quality.score,
      reasons: quality.reasons,
    });
    try {
      await deleteCachedRecipe(env.RECIPE_CACHE, sourceUrl);
    } catch (error) {
      console.log(
        "Cached recipe delete failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  // Check if this URL requires browser rendering (Instagram, TikTok, etc.)
  const needsBrowser = requiresBrowserRendering(sourceUrl);

  // Fetch HTML (use browser for JS-heavy sites, regular fetch otherwise)
  let html: string;
  const candidates: RecipeCandidate[] = [];
  const fetchStart = Date.now();
  try {
    if (needsBrowser) {
      console.log("Using browser rendering for:", sourceUrl);
      html = await fetchHtmlWithBrowser(env.BROWSER, sourceUrl);
      diagnostics = recordDiagnosticsStage(diagnostics, "browser", fetchStart);
    } else {
      html = await fetchHtml(sourceUrl, 1);
      diagnostics = recordDiagnosticsStage(diagnostics, "fetch", fetchStart);
    }
  } catch (error) {
    diagnostics = recordDiagnosticsStage(
      diagnostics,
      needsBrowser ? "browser" : "fetch",
      fetchStart,
      "error",
      error instanceof Error ? error.message : "fetch_failed",
    );
    const readerStart = Date.now();
    const readerCandidates = await collectReaderCandidates(sourceUrl);
    diagnostics = recordDiagnosticsStage(
      appendFallbackPath(diagnostics, "reader_after_fetch_error"),
      "reader",
      readerStart,
    );
    const readerResult = await selectBestRecipeCandidate(
      env,
      sourceUrl,
      readerCandidates,
      {
        canonicalUrl: sourceUrl,
        diagnostics,
      },
    );
    if (readerResult) return readerResult;

    if (!needsBrowser && isLikelyBotBlockedError(error)) {
      try {
        console.log(
          "Regular fetch appears blocked; retrying with browser rendering:",
          sourceUrl,
        );
        const browserStart = Date.now();
        html = await fetchHtmlWithBrowser(env.BROWSER, sourceUrl);
        diagnostics = recordDiagnosticsStage(
          appendFallbackPath(diagnostics, "browser_after_fetch_block"),
          "browser",
          browserStart,
        );
      } catch (browserError) {
        diagnostics = recordDiagnosticsStage(
          diagnostics,
          "browser",
          Date.now(),
          "error",
          browserError instanceof Error
            ? browserError.message
            : "browser_fetch_failed",
        );
        console.error("Browser fetch error:", browserError);
        return {
          success: false,
          error: {
            code: "FETCH_FAILED",
            message:
              browserError instanceof Error
                ? browserError.message
                : "Failed to fetch URL",
          },
          metadata: {
            source: "url",
            confidence: "low",
            canonicalUrl: sourceUrl,
            diagnostics,
          },
        };
      }
    } else {
      console.error("Fetch error:", error);
      return {
        success: false,
        error: {
          code: "FETCH_FAILED",
          message:
            error instanceof Error ? error.message : "Failed to fetch URL",
        },
        metadata: {
          source: "url",
          confidence: "low",
          canonicalUrl: sourceUrl,
          diagnostics,
        },
      };
    }
  }

  // Try deterministic extraction first (JSON-LD, hydration, microdata, recipe cards,
  // visible cards, outline rules, alternates, WordPress REST, and reader text).
  const mainStart = Date.now();
  try {
    candidates.push(
      ...deterministicHtmlCandidates(html, sourceUrl, sourceUrl).map(
        (candidate) => ({
          ...candidate,
          elapsedMs: elapsed(mainStart),
        }),
      ),
    );
    diagnostics = recordDiagnosticsStage(
      diagnostics,
      "deterministic_parse",
      mainStart,
    );
  } catch (error) {
    console.error("Deterministic extraction error:", error);
    diagnostics = recordDiagnosticsStage(
      diagnostics,
      "deterministic_parse",
      mainStart,
      "error",
      error instanceof Error ? error.message : "deterministic_parse_failed",
    );
    candidates.push({
      recipe: null,
      source: "structured",
      parseMethod: "schema_org",
      elapsedMs: elapsed(mainStart),
      evidence: { sourceUrl },
      error,
    });
  }

  const mainDeterministicResult = await selectBestRecipeCandidate(
    env,
    sourceUrl,
    candidates,
    {
      canonicalUrl: sourceUrl,
      diagnostics,
    },
  );
  if (mainDeterministicResult) return mainDeterministicResult;

  const alternateStart = Date.now();
  candidates.push(
    ...(await collectAlternateRecipePageCandidates(sourceUrl, html)),
  );
  diagnostics = recordDiagnosticsStage(
    appendFallbackPath(diagnostics, "alternate_recipe_pages"),
    "linked_url",
    alternateStart,
  );
  const wordPressStart = Date.now();
  candidates.push(...(await collectWordPressRestCandidates(sourceUrl, html)));
  diagnostics = recordDiagnosticsStage(
    diagnostics,
    "deterministic_parse",
    wordPressStart,
    "success",
    "wordpress_rest",
  );

  const initialEvaluation = evaluateRecipeCandidates(candidates);
  const bestInitialScore = initialEvaluation.accepted[0]?.quality.score ?? 0;
  if (structuredOnly || bestInitialScore < 75) {
    const readerStart = Date.now();
    candidates.push(...(await collectReaderCandidates(sourceUrl)));
    diagnostics = recordDiagnosticsStage(
      appendFallbackPath(diagnostics, "reader"),
      "reader",
      readerStart,
    );
  }

  const deterministicResult = await selectBestRecipeCandidate(
    env,
    sourceUrl,
    candidates,
    {
      canonicalUrl: sourceUrl,
      diagnostics,
    },
  );
  if (deterministicResult) return deterministicResult;

  if (structuredOnly) {
    return {
      success: false,
      error: {
        code: "NO_STRUCTURED_DATA",
        message:
          "This website doesn't have deterministic recipe data that we can read.",
      },
      metadata: {
        source: "url",
        confidence: "low",
        canonicalUrl: sourceUrl,
        diagnostics: {
          ...diagnostics,
          attempts: evaluateRecipeCandidates(candidates).diagnostics,
        },
      },
    };
  }

  // For Smart Import: extract with AI when structured data is missing or incomplete.
  const aiStart = Date.now();
  try {
    const cleanedContent = focusRecipeContent(cleanHtml(html));

    if (cleanedContent.length < 100) {
      return {
        success: false,
        error: {
          code: "NO_CONTENT",
          message: "Not enough content found on the page",
        },
        metadata: {
          source: "url",
          confidence: "low",
          canonicalUrl: sourceUrl,
          diagnostics: recordDiagnosticsStage(
            appendFallbackPath(diagnostics, "ai"),
            "ai",
            aiStart,
            "skipped",
            "not_enough_content",
          ),
        },
      };
    }

    // Extract step image context to help AI associate images with steps
    const imageUrls = extractImageUrls(html, sourceUrl);
    const stepImageContext = extractStepImageContext(html, sourceUrl);
    const bestPartialRecipe = bestPartialCandidate(candidates);
    const aiResult = bestPartialRecipe
      ? await repairRecipeFromEvidence(
          env.AI,
          cleanedContent + stepImageContext,
          bestPartialRecipe,
        )
      : await parseRecipeFromHtml(env.AI, cleanedContent + stepImageContext);
    const recipe = aiResultToRecipe(aiResult, {
      sourceType: "url",
      sourceUrl,
      images: imageUrls,
    });
    diagnostics = recordDiagnosticsStage(
      appendFallbackPath(diagnostics, bestPartialRecipe ? "ai_repair" : "ai"),
      "ai",
      aiStart,
      "success",
      bestPartialRecipe ? "repair" : "parse",
    );
    const aiResultResponse = await selectBestRecipeCandidate(
      env,
      sourceUrl,
      [
        {
          recipe,
          source: "ai",
          parseMethod: bestPartialRecipe ? "ai_repair" : "ai_only",
          evidence: {
            imageCount: imageUrls.length,
            textLength: cleanedContent.length,
            sourceUrl,
          },
        },
      ],
      {
        canonicalUrl: sourceUrl,
        diagnostics: {
          ...diagnostics,
          attempts: evaluateRecipeCandidates(candidates).diagnostics,
        },
      },
    );

    if (!aiResultResponse) {
      console.log("validation error");
      return {
        success: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "AI output did not match expected schema",
        },
        metadata: {
          source: "url",
          confidence: "low",
          canonicalUrl: sourceUrl,
          diagnostics: {
            ...diagnostics,
            attempts: evaluateRecipeCandidates([
              ...candidates,
              {
                recipe,
                source: "ai",
                parseMethod: bestPartialRecipe ? "ai_repair" : "ai_only",
                evidence: {
                  imageCount: imageUrls.length,
                  textLength: cleanedContent.length,
                  sourceUrl,
                },
              },
            ]).diagnostics,
          },
        },
      };
    }

    return aiResultResponse;
  } catch (error) {
    diagnostics = recordDiagnosticsStage(
      appendFallbackPath(diagnostics, "ai"),
      "ai",
      aiStart,
      "error",
      error instanceof Error ? error.message : "ai_parse_failed",
    );
    console.log(error);
    return {
      success: false,
      error: {
        code: "AI_PARSE_FAILED",
        message: error instanceof Error ? error.message : "AI parsing failed",
      },
      metadata: {
        source: "url",
        confidence: "low",
        canonicalUrl: sourceUrl,
        diagnostics,
      },
    };
  }
}
