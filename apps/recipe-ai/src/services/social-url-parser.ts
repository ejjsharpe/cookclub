import * as cheerio from "cheerio";

import type { ParsedRecipe } from "../schema";
import type { Env, ParseMetadata, ParseResult } from "../types";
import {
  evaluateRecipeCandidates,
  type RecipeCandidate,
  reuploadImagesToR2,
  selectBestRecipeCandidate,
  tryAiRecipeCandidate,
} from "./url-parse-utils";
import {
  extractInstagramContent as extractInstagramContentBrowser,
  extractTikTokBrowserContent,
  fetchHtmlWithBrowser,
} from "../utils/browser-fetcher";
import {
  cleanHtml,
  extractImageUrls,
  focusRecipeContent,
} from "../utils/html-cleaner";
import { fetchHtml } from "../utils/html-fetcher";
import {
  extractInstagramContent as extractInstagramContentOembed,
  extractShortcode,
} from "../utils/instagram-fetcher";
import { extractRecipeOutline } from "../utils/recipe-outline-parser";
import { extractSocialCaptionRecipe } from "../utils/social-caption-recipe";
import { enrichSocialMediaRecipeText } from "../utils/social-media-enrichment";
import {
  extractTikTokContent,
  type TikTokContent,
} from "../utils/tiktok-fetcher";

export type SocialPlatform =
  | "instagram"
  | "tiktok"
  | "facebook"
  | "youtube"
  | "pinterest"
  | "threads"
  | "x"
  | "reddit";

const SOCIAL_PLATFORM_DOMAINS: Record<SocialPlatform, string[]> = {
  instagram: ["instagram.com"],
  tiktok: ["tiktok.com"],
  facebook: ["facebook.com", "fb.com"],
  youtube: ["youtube.com", "youtu.be"],
  pinterest: ["pinterest.com", "pin.it"],
  threads: ["threads.net"],
  x: ["x.com", "twitter.com"],
  reddit: ["reddit.com"],
};

function hostnameMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function getSocialPlatform(url: string): SocialPlatform | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase();

    for (const [platform, domains] of Object.entries(
      SOCIAL_PLATFORM_DOMAINS,
    ) as [SocialPlatform, string[]][]) {
      if (domains.some((domain) => hostnameMatches(hostname, domain))) {
        return platform;
      }
    }

    return null;
  } catch {
    return null;
  }
}

function socialPrefix(platform: SocialPlatform): string {
  return `social/${platform}`;
}

interface SocialParseOptions {
  diagnostics?: ParseMetadata["diagnostics"];
}

function socialCandidateDiagnostics(
  options?: SocialParseOptions,
): ParseMetadata["diagnostics"] | undefined {
  return options?.diagnostics;
}

function socialDeterministicCandidates(options: {
  url: string;
  content: string | null;
  images: string[];
}): RecipeCandidate[] {
  return [
    {
      recipe: extractSocialCaptionRecipe(
        options.content,
        options.url,
        options.images,
      ),
      source: "social_ai",
      parseMethod: "caption_rules",
      cache: false,
      evidence: {
        imageCount: options.images.length,
        textLength: options.content?.length ?? 0,
        sourceUrl: options.url,
      },
    },
    {
      recipe: extractRecipeOutline(options.content, {
        sourceUrl: options.url,
        sourceType: "url",
        images: options.images,
      }),
      source: "social_ai",
      parseMethod: "outline_rules",
      cache: false,
      evidence: {
        imageCount: options.images.length,
        textLength: options.content?.length ?? 0,
        sourceUrl: options.url,
      },
    },
  ];
}

async function finalizeSocialResult(
  env: Env,
  url: string,
  platform: SocialPlatform,
  result: ParseResult,
  images: string[],
): Promise<ParseResult> {
  if (!result.success) return result;

  const permanentImages = await reuploadImagesToR2(
    env,
    images,
    socialPrefix(platform),
  );
  if (!permanentImages.length) return result;

  return {
    ...result,
    data: {
      ...result.data,
      images: permanentImages,
    },
  };
}

async function parseSocialTextRecipe(
  env: Env,
  options: {
    url: string;
    platform: SocialPlatform;
    content: string | null;
    images: string[];
    noContentMessage: string;
    aiErrorCode: string;
  } & SocialParseOptions,
): Promise<ParseResult> {
  if (!options.content || options.content.length < 50) {
    return {
      success: false,
      error: {
        code: "NO_CONTENT",
        message: options.noContentMessage,
      },
    };
  }

  const candidates = socialDeterministicCandidates({
    url: options.url,
    content: options.content,
    images: options.images,
  });
  const deterministicEvaluation = evaluateRecipeCandidates(candidates);
  if ((deterministicEvaluation.accepted[0]?.quality.score ?? 0) >= 75) {
    const deterministicResult = await selectBestRecipeCandidate(
      env,
      options.url,
      candidates,
      {
        cache: false,
        canonicalUrl: options.url,
        diagnostics: socialCandidateDiagnostics(options),
      },
    );
    if (deterministicResult) {
      return finalizeSocialResult(
        env,
        options.url,
        options.platform,
        deterministicResult,
        options.images,
      );
    }
  }

  const aiAttempt = await tryAiRecipeCandidate(
    env,
    options.url,
    options.content,
    options.images,
    "social_ai",
    "ai_only",
    `[${options.platform}]`,
    { cache: false },
  );
  if (aiAttempt.result?.success) {
    candidates.push({
      recipe: aiAttempt.result.data,
      source: "social_ai",
      parseMethod: aiAttempt.result.metadata.parseMethod,
      cache: false,
      evidence: {
        imageCount: options.images.length,
        textLength: options.content.length,
        sourceUrl: options.url,
      },
    });
  }

  const bestResult = await selectBestRecipeCandidate(
    env,
    options.url,
    candidates,
    {
      cache: false,
      canonicalUrl: options.url,
      diagnostics: socialCandidateDiagnostics(options),
    },
  );
  if (bestResult) {
    return finalizeSocialResult(
      env,
      options.url,
      options.platform,
      bestResult,
      options.images,
    );
  }

  return {
    success: false,
    error: {
      code: aiAttempt.error ? options.aiErrorCode : "VALIDATION_FAILED",
      message:
        aiAttempt.error instanceof Error
          ? aiAttempt.error.message
          : `Could not parse a valid recipe from this ${options.platform} content`,
    },
  };
}

async function parseInstagramUrl(
  env: Env,
  url: string,
  options?: SocialParseOptions,
): Promise<ParseResult> {
  const shortcode = extractShortcode(url) || "unknown";
  console.log(`Parsing Instagram URL [${shortcode}]:`, url);

  let contentForAi: string | null = null;
  let images: string[] = [];
  let method: "oembed" | "browser" = "oembed";

  try {
    console.log(`[${shortcode}] Trying oembed API...`);
    const oembedResult = await extractInstagramContentOembed(url);

    if (oembedResult.caption && oembedResult.caption.length >= 50) {
      contentForAi = oembedResult.caption;
      images = oembedResult.images;
      console.log(`[${shortcode}] Oembed success:`, {
        captionLength: contentForAi.length,
        imageCount: images.length,
        author: oembedResult.authorName,
      });
    } else {
      console.log(
        `[${shortcode}] Oembed returned insufficient content (${oembedResult.caption?.length || 0} chars)`,
      );
    }
  } catch (oembedError) {
    console.log(
      `[${shortcode}] Oembed failed:`,
      oembedError instanceof Error ? oembedError.message : oembedError,
    );
  }

  if (!contentForAi || contentForAi.length < 50) {
    try {
      console.log(`[${shortcode}] Falling back to browser rendering...`);
      method = "browser";
      const browserResult = await extractInstagramContentBrowser(
        env.BROWSER,
        url,
      );

      if (browserResult.caption && browserResult.caption.length >= 50) {
        contentForAi = browserResult.caption;
        images = browserResult.images;
      } else {
        const cleanedContent = cleanHtml(browserResult.html);
        if (cleanedContent.length >= 100) {
          contentForAi = cleanedContent;
          images = browserResult.images;
        }
      }

      if (contentForAi) {
        console.log(`[${shortcode}] Browser rendering success:`, {
          captionLength: contentForAi.length,
          imageCount: images.length,
        });
      }
    } catch (browserError) {
      console.log(
        `[${shortcode}] Browser rendering failed:`,
        browserError instanceof Error ? browserError.message : browserError,
      );
    }
  }

  const result = await parseSocialTextRecipe(env, {
    url,
    platform: "instagram",
    content: contentForAi,
    images,
    noContentMessage:
      "Could not extract recipe content from Instagram. The post may not contain a recipe or may require login to view.",
    aiErrorCode: "INSTAGRAM_PARSE_FAILED",
    diagnostics: options?.diagnostics,
  });
  if (result.success) {
    console.log(
      `[${shortcode}] Successfully parsed recipe via ${method}: "${result.data.name}"`,
    );
  }

  return result;
}

function uniqueTextParts(values: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const parts: string[] = [];

  for (const value of values) {
    const normalized = value?.replace(/\s+/g, " ").trim();
    if (!normalized) continue;

    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    parts.push(normalized);
  }

  return parts;
}

function extractGenericSocialText(
  html: string,
  platform: SocialPlatform,
): string {
  const $ = cheerio.load(html);
  const metaSelectors = [
    'meta[property="og:description"]',
    'meta[name="twitter:description"]',
    'meta[name="description"]',
    'meta[property="og:title"]',
    'meta[name="twitter:title"]',
    "title",
  ];

  const metaParts = metaSelectors.map((selector) => {
    const element = $(selector).first();
    return element.attr("content") || element.text();
  });
  const pageText = focusRecipeContent(cleanHtml(html), 12_000);
  const parts = uniqueTextParts([
    `${platform} social post`,
    ...metaParts,
    pageText.length >= 100 ? pageText : null,
  ]);

  return parts.join("\n\n");
}

function parseGenericSocialHtml(
  env: Env,
  url: string,
  platform: SocialPlatform,
  html: string,
  options?: SocialParseOptions,
): Promise<ParseResult> {
  return parseSocialTextRecipe(env, {
    url,
    platform,
    content: extractGenericSocialText(html, platform),
    images: extractImageUrls(html, url),
    noContentMessage:
      "Could not extract recipe content from this social media link.",
    aiErrorCode: "AI_PARSE_FAILED",
    diagnostics: options?.diagnostics,
  });
}

async function parseGenericSocialUrl(
  env: Env,
  url: string,
  platform: SocialPlatform,
  options?: SocialParseOptions,
): Promise<ParseResult> {
  let plainResult: ParseResult | null = null;
  let fetchError: unknown = null;

  try {
    plainResult = await parseGenericSocialHtml(
      env,
      url,
      platform,
      await fetchHtml(url, 1),
      options,
    );
    if (plainResult.success) return plainResult;
  } catch (error) {
    fetchError = error;
  }

  if (env.BROWSER) {
    try {
      const browserResult = await parseGenericSocialHtml(
        env,
        url,
        platform,
        await fetchHtmlWithBrowser(env.BROWSER, url),
        options,
      );
      if (browserResult.success || !plainResult) return browserResult;
    } catch (browserError) {
      if (!plainResult) {
        return {
          success: false,
          error: {
            code: "FETCH_FAILED",
            message:
              browserError instanceof Error
                ? browserError.message
                : `Failed to fetch ${platform} content`,
          },
        };
      }
    }
  }

  if (plainResult) return plainResult;

  return {
    success: false,
    error: {
      code: "FETCH_FAILED",
      message:
        fetchError instanceof Error
          ? fetchError.message
          : `Failed to fetch ${platform} content`,
    },
  };
}

function mergeUniqueStrings(...groups: string[][]): string[] {
  return Array.from(new Set(groups.flat().filter(Boolean)));
}

function hasGenericSocialInstruction(recipe: ParsedRecipe | null): boolean {
  const instructions = recipe?.instructionSections.flatMap(
    (section) => section.instructions,
  );
  if (!instructions?.length) return true;

  return (
    instructions.length === 1 &&
    /follow the method shown in the source video using the listed ingredients/i.test(
      instructions[0]?.instruction ?? "",
    )
  );
}

async function tryTikTokBrowserMedia(
  env: Env,
  url: string,
): Promise<{
  content: TikTokContent;
  frameImages: Uint8Array[];
} | null> {
  if (!env.BROWSER) return null;

  try {
    const browserContent = await extractTikTokBrowserContent(env.BROWSER, url);
    return {
      content: {
        caption: browserContent.caption,
        images: browserContent.images,
        videoUrls: browserContent.videoUrls,
        subtitleUrls: [],
        transcript: null,
      },
      frameImages: browserContent.frameImages,
    };
  } catch (error) {
    console.log(
      "[TikTok] Browser media extraction failed:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
function mergeTikTokContent(
  current: TikTokContent,
  next: TikTokContent,
): TikTokContent {
  return {
    caption: current.caption || next.caption,
    images: mergeUniqueStrings(current.images, next.images),
    videoUrls: mergeUniqueStrings(current.videoUrls, next.videoUrls),
    subtitleUrls: mergeUniqueStrings(current.subtitleUrls, next.subtitleUrls),
    transcript: current.transcript || next.transcript,
  };
}

async function parseTikTokUrl(
  env: Env,
  url: string,
  options?: SocialParseOptions,
): Promise<ParseResult> {
  try {
    let result: TikTokContent = {
      caption: null,
      images: [],
      videoUrls: [],
      subtitleUrls: [],
      transcript: null,
    };
    try {
      result = await extractTikTokContent(url);
    } catch (oembedError) {
      console.log(
        "[TikTok] Oembed failed:",
        oembedError instanceof Error ? oembedError.message : oembedError,
      );
    }

    let frameImages: Uint8Array[] = [];
    let attemptedBrowserMedia = false;
    if (!result.caption || result.caption.length < 50) {
      attemptedBrowserMedia = true;
      const browserMedia = await tryTikTokBrowserMedia(env, url);
      if (browserMedia) {
        result = mergeTikTokContent(result, browserMedia.content);
        frameImages = browserMedia.frameImages;
      }
    }

    const fallbackRecipe = extractSocialCaptionRecipe(
      result.caption,
      url,
      result.images,
    );
    const shouldTryFrameOcr = hasGenericSocialInstruction(fallbackRecipe);
    const hasEnrichmentSource =
      Boolean(result.transcript) ||
      result.videoUrls.length > 0 ||
      frameImages.length > 0 ||
      Boolean(env.BROWSER && !attemptedBrowserMedia);

    if (
      !fallbackRecipe &&
      (!result.caption || result.caption.length < 50) &&
      !hasEnrichmentSource
    ) {
      return {
        success: false,
        error: {
          code: "NO_CONTENT",
          message:
            "Could not extract recipe content from TikTok. The video may not contain a recipe or the description may be too short.",
        },
      };
    }

    const candidates = socialDeterministicCandidates({
      url,
      content: result.caption,
      images: result.images,
    });

    const captionAiAttempt = await tryAiRecipeCandidate(
      env,
      url,
      result.caption,
      result.images,
      "social_ai",
      "ai_only",
      "[TikTok]",
      { cache: false },
    );
    if (captionAiAttempt.result?.success) {
      candidates.push({
        recipe: captionAiAttempt.result.data,
        source: "social_ai",
        parseMethod: captionAiAttempt.result.metadata.parseMethod,
        cache: false,
        evidence: {
          imageCount: result.images.length,
          textLength: result.caption?.length ?? 0,
          sourceUrl: url,
        },
      });
    }

    const captionEvaluation = evaluateRecipeCandidates(candidates);
    if ((captionEvaluation.accepted[0]?.quality.score ?? 0) >= 75) {
      const captionResult = await selectBestRecipeCandidate(
        env,
        url,
        candidates,
        {
          cache: false,
          canonicalUrl: url,
          diagnostics: socialCandidateDiagnostics(options),
        },
      );
      if (captionResult) {
        return finalizeSocialResult(
          env,
          url,
          "tiktok",
          captionResult,
          result.images,
        );
      }
    }

    if (
      result.transcript ||
      result.videoUrls.length > 0 ||
      frameImages.length > 0 ||
      (env.BROWSER &&
        !attemptedBrowserMedia &&
        result.videoUrls.length === 0 &&
        frameImages.length === 0)
    ) {
      if (
        env.BROWSER &&
        !attemptedBrowserMedia &&
        frameImages.length === 0 &&
        (result.videoUrls.length === 0 || shouldTryFrameOcr)
      ) {
        attemptedBrowserMedia = true;
        const browserMedia = await tryTikTokBrowserMedia(env, url);
        if (browserMedia) {
          result = mergeTikTokContent(result, browserMedia.content);
          frameImages = browserMedia.frameImages;
        }
      }

      const enrichment = await enrichSocialMediaRecipeText(env.AI, {
        caption: result.caption,
        transcript: result.transcript,
        videoUrls: result.videoUrls,
        frameImages,
      });

      if (enrichment.transcript || enrichment.frameText) {
        const enrichedAiAttempt = await tryAiRecipeCandidate(
          env,
          url,
          enrichment.enrichedText,
          result.images,
          "social_ai",
          "media_enriched",
          "[TikTok]",
          { cache: false },
        );
        if (enrichedAiAttempt.result?.success) {
          candidates.push({
            recipe: enrichedAiAttempt.result.data,
            source: "social_ai",
            parseMethod: enrichedAiAttempt.result.metadata.parseMethod,
            cache: false,
            evidence: {
              imageCount: result.images.length,
              textLength: enrichment.enrichedText.length,
              sourceUrl: url,
            },
          });
        }
      }
    }

    if (fallbackRecipe) {
      console.log(
        "[TikTok] Falling back to caption ingredient extraction after AI/media parsing did not produce a valid recipe.",
      );
    }

    const fallbackResult = await selectBestRecipeCandidate(
      env,
      url,
      candidates,
      {
        cache: false,
        canonicalUrl: url,
        diagnostics: socialCandidateDiagnostics(options),
      },
    );
    if (fallbackResult) {
      return finalizeSocialResult(
        env,
        url,
        "tiktok",
        fallbackResult,
        result.images,
      );
    }

    return {
      success: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "Could not parse a valid recipe from the TikTok content",
      },
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: "TIKTOK_PARSE_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Failed to parse TikTok content",
      },
    };
  }
}

export function parseSocialUrl(
  env: Env,
  url: string,
  platform: SocialPlatform,
  options?: SocialParseOptions,
): Promise<ParseResult> {
  if (platform === "instagram") return parseInstagramUrl(env, url, options);
  if (platform === "tiktok") return parseTikTokUrl(env, url, options);
  return parseGenericSocialUrl(env, url, platform, options);
}
