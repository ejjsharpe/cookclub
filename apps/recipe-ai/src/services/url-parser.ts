import { ParsedRecipeSchema } from "../schema";
import type { Env, ParseResult } from "../types";
import { parseRecipeFromHtml, repairRecipeFromEvidence } from "./ai-client";
import { deleteCachedRecipe, getCachedRecipe } from "./cache";
import { aiResultToRecipe } from "./recipe-mapper";
import { parseSocialUrl } from "./social-url-parser";
import { createSourceSnapshot } from "./source-snapshot";
import {
  bestPartialCandidate,
  collectAlternateRecipePageCandidates,
  collectReaderCandidates,
  collectWordPressRestCandidates,
  deterministicHtmlCandidates,
} from "./url-candidate-collectors";
import {
  evaluateRecipeCandidates,
  type RecipeCandidate,
  selectBestRecipeCandidate,
} from "./url-parse-utils";
import type { AiClient } from "../utils/ai-response-parser";
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
import { fetchHtml, isLikelyBotBlockedError } from "../utils/html-fetcher";
import {
  appendFallbackPath,
  recordDiagnosticsStage,
} from "../utils/parse-diagnostics";
import {
  evaluateRecipeQuality,
  normalizeRecipeForImport,
} from "../utils/recipe-quality";

export interface ParseUrlOptions {
  /** If true, only use structured data extraction (no AI). For Basic Import. */
  structuredOnly?: boolean;
  /** Internal guard: linked-page fallbacks should not recursively parse social URLs. */
  allowSocial?: boolean;
  aiClient: AiClient;
}

function elapsed(startTime: number): number {
  return Math.max(0, Date.now() - startTime);
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
  options: ParseUrlOptions,
): Promise<ParseResult> {
  const { structuredOnly = false, allowSocial = true, aiClient } = options;
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
        parseUrl(env, linkedUrl, {
          allowSocial: false,
          aiClient,
        }),
      aiClient,
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
          aiClient,
          cleanedContent + stepImageContext,
          bestPartialRecipe,
        )
      : await parseRecipeFromHtml(aiClient, cleanedContent + stepImageContext);
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
