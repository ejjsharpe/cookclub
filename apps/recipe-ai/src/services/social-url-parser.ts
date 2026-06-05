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
  type InstagramBrowserContent,
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
import { extractSocialRecipeLinks } from "../utils/social-recipe-links";
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
  parseLinkedRecipeUrl?: (url: string) => Promise<ParseResult>;
}

function socialCandidateDiagnostics(
  options?: SocialParseOptions,
): ParseMetadata["diagnostics"] | undefined {
  return options?.diagnostics;
}

function linkedRecipeDiagnostics(
  result: Extract<ParseResult, { success: true }>,
  linkedUrl: string,
  index: number,
  options?: SocialParseOptions,
): NonNullable<ParseMetadata["diagnostics"]> {
  const linkedDiagnostics = result.metadata.diagnostics;

  return {
    ...options?.diagnostics,
    canonicalUrl: result.metadata.canonicalUrl ?? linkedUrl,
    selectedAttempt:
      linkedDiagnostics?.selectedAttempt ?? `linked-recipe-${index + 1}`,
    attempts: [
      ...(options?.diagnostics?.attempts ?? []),
      {
        id: `linked-recipe-${index + 1}`,
        method: "linked_url",
        source: "url",
        status: "accepted" as const,
        confidence: result.metadata.confidence,
        evidence: { sourceUrl: linkedUrl },
      },
      ...(linkedDiagnostics?.attempts ?? []),
    ].slice(-12),
  };
}

async function tryLinkedRecipeUrls(
  urls: string[],
  options?: SocialParseOptions,
): Promise<ParseResult | null> {
  if (!options?.parseLinkedRecipeUrl || urls.length === 0) return null;

  for (const [index, url] of urls.entries()) {
    try {
      console.log(`[social] Trying linked recipe URL: ${url}`);
      const result = await options.parseLinkedRecipeUrl(url);
      if (!result.success) {
        console.log(`[social] Linked recipe URL did not parse:`, {
          url,
          code: result.error.code,
          message: result.error.message,
        });
        continue;
      }

      return {
        ...result,
        data: {
          ...result.data,
          sourceType: result.data.sourceType ?? "url",
          sourceUrl:
            result.data.sourceUrl ?? result.metadata.canonicalUrl ?? url,
        },
        metadata: {
          ...result.metadata,
          canonicalUrl: result.metadata.canonicalUrl ?? url,
          diagnostics: linkedRecipeDiagnostics(result, url, index, options),
        },
      };
    } catch (error) {
      console.log(
        "[social] Linked recipe URL parse failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  return null;
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
        polish: true,
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
      polish: true,
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

interface InstagramMediaContent {
  caption: string | null;
  images: string[];
  videoUrls: string[];
}

function mergeInstagramContent(
  current: InstagramMediaContent,
  next: InstagramMediaContent,
): InstagramMediaContent {
  return {
    caption: current.caption || next.caption,
    images: mergeUniqueStrings(current.images, next.images),
    videoUrls: mergeUniqueStrings(current.videoUrls, next.videoUrls),
  };
}

function browserRecipeText(html: string): string | null {
  const text = focusRecipeContent(cleanHtml(html), 12_000);
  return text.length >= 100 ? text : null;
}

async function tryInstagramBrowserMedia(
  env: Env,
  url: string,
  shortcode: string,
): Promise<InstagramBrowserContent | null> {
  if (!env.BROWSER) return null;

  try {
    console.log(`[${shortcode}] Trying browser media extraction...`);
    return await extractInstagramContentBrowser(env.BROWSER, url);
  } catch (error) {
    console.log(
      `[${shortcode}] Browser media extraction failed:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

async function parseInstagramUrl(
  env: Env,
  url: string,
  options?: SocialParseOptions,
): Promise<ParseResult> {
  const shortcode = extractShortcode(url) || "unknown";
  console.log(`Parsing Instagram URL [${shortcode}]:`, url);

  let result: InstagramMediaContent = {
    caption: null,
    images: [],
    videoUrls: [],
  };
  let frameImages: Uint8Array[] = [];
  let attemptedBrowserMedia = false;
  let browserPageText: string | null = null;

  try {
    console.log(`[${shortcode}] Trying oembed API...`);
    const oembedResult = await extractInstagramContentOembed(url);

    result = mergeInstagramContent(result, {
      caption: oembedResult.caption,
      images: oembedResult.images,
      videoUrls: [],
    });

    if (oembedResult.caption && oembedResult.caption.length >= 50) {
      console.log(`[${shortcode}] Oembed success:`, {
        captionLength: oembedResult.caption.length,
        imageCount: oembedResult.images.length,
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

  if (!result.caption || result.caption.length < 50) {
    attemptedBrowserMedia = true;
    const browserMedia = await tryInstagramBrowserMedia(env, url, shortcode);
    if (browserMedia) {
      result = mergeInstagramContent(result, {
        caption: browserMedia.caption,
        images: browserMedia.images,
        videoUrls: browserMedia.videoUrls,
      });
      frameImages = browserMedia.frameImages;
      browserPageText = browserRecipeText(browserMedia.html);

      if (!result.caption || result.caption.length < 50) {
        if (browserPageText) {
          result = { ...result, caption: browserPageText };
        }
      }

      if (result.caption) {
        console.log(`[${shortcode}] Browser rendering success:`, {
          captionLength: result.caption.length,
          imageCount: result.images.length,
          videoCount: result.videoUrls.length,
          frameCount: frameImages.length,
        });
      }
    }
  }

  const fallbackRecipe = extractSocialCaptionRecipe(
    result.caption,
    url,
    result.images,
  );
  const hasEnrichmentSource =
    result.videoUrls.length > 0 ||
    frameImages.length > 0 ||
    Boolean(env.BROWSER && !attemptedBrowserMedia);
  const attemptedLinkedRecipeUrls = new Set<string>();
  const hasLinkedRecipeFallback = () =>
    extractSocialRecipeLinks([result.caption, browserPageText], url).length > 0;
  const tryLinkedRecipeFallback = async () => {
    const linkedRecipeUrls = extractSocialRecipeLinks(
      [result.caption, browserPageText],
      url,
    ).filter((linkedUrl) => !attemptedLinkedRecipeUrls.has(linkedUrl));

    for (const linkedUrl of linkedRecipeUrls) {
      attemptedLinkedRecipeUrls.add(linkedUrl);
    }

    return tryLinkedRecipeUrls(linkedRecipeUrls, options);
  };

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
    "[Instagram]",
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
  const bestCaption = captionEvaluation.accepted[0];
  const bestCaptionHasGenericInstruction = hasGenericSocialInstruction(
    bestCaption?.recipe ?? fallbackRecipe,
  );
  if (
    bestCaption &&
    (!bestCaptionHasGenericInstruction ||
      (!hasEnrichmentSource && !hasLinkedRecipeFallback()))
  ) {
    const captionResult = await selectBestRecipeCandidate(
      env,
      url,
      candidates,
      {
        cache: false,
        canonicalUrl: url,
        diagnostics: socialCandidateDiagnostics(options),
        polish: true,
      },
    );
    if (captionResult?.success) {
      console.log(
        `[${shortcode}] Successfully parsed recipe via oembed: "${captionResult.data.name}"`,
      );
      return finalizeSocialResult(
        env,
        url,
        "instagram",
        captionResult,
        result.images,
      );
    }
  }

  const linkedRecipeResult = await tryLinkedRecipeFallback();
  if (linkedRecipeResult?.success) return linkedRecipeResult;

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
          "Could not extract recipe content from Instagram. The post may not contain a recipe or may require login to view.",
      },
    };
  }

  if (hasEnrichmentSource) {
    if (env.BROWSER && !attemptedBrowserMedia) {
      attemptedBrowserMedia = true;
      const browserMedia = await tryInstagramBrowserMedia(env, url, shortcode);
      if (browserMedia) {
        result = mergeInstagramContent(result, {
          caption: browserMedia.caption,
          images: browserMedia.images,
          videoUrls: browserMedia.videoUrls,
        });
        frameImages = browserMedia.frameImages;
        browserPageText = browserRecipeText(browserMedia.html);
      }
    }

    const renderedLinkedRecipeResult = await tryLinkedRecipeFallback();
    if (renderedLinkedRecipeResult?.success) return renderedLinkedRecipeResult;

    if (
      result.videoUrls.length > 0 ||
      frameImages.length > 0 ||
      browserPageText
    ) {
      const enrichment = await enrichSocialMediaRecipeText(env.AI, {
        platform: "instagram",
        caption: result.caption,
        pageText: browserPageText,
        videoUrls: result.videoUrls,
        frameImages,
      });

      if (enrichment.transcript || enrichment.frameText || browserPageText) {
        const enrichedAiAttempt = await tryAiRecipeCandidate(
          env,
          url,
          enrichment.enrichedText,
          result.images,
          "social_ai",
          "media_enriched",
          "[Instagram]",
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
  }

  if (fallbackRecipe) {
    console.log(
      "[Instagram] Falling back to caption ingredient extraction after AI/media parsing did not produce a valid recipe.",
    );
  }

  const fallbackResult = await selectBestRecipeCandidate(env, url, candidates, {
    cache: false,
    canonicalUrl: url,
    diagnostics: socialCandidateDiagnostics(options),
    polish: true,
  });
  if (fallbackResult?.success) {
    console.log(
      `[${shortcode}] Successfully parsed recipe via ${fallbackResult.metadata.parseMethod ?? "caption"}: "${fallbackResult.data.name}"`,
    );
    return finalizeSocialResult(
      env,
      url,
      "instagram",
      fallbackResult,
      result.images,
    );
  }

  return {
    success: false,
    error: {
      code: captionAiAttempt.error
        ? "INSTAGRAM_PARSE_FAILED"
        : "VALIDATION_FAILED",
      message:
        captionAiAttempt.error instanceof Error
          ? captionAiAttempt.error.message
          : "Could not parse a valid recipe from the Instagram content",
    },
  };
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

function extractAnchorHrefValues(html: string): string[] {
  const $ = cheerio.load(html);
  return $("a[href]")
    .toArray()
    .map((element) => $(element).attr("href") || "")
    .filter(Boolean);
}

async function parseGenericSocialHtml(
  env: Env,
  url: string,
  platform: SocialPlatform,
  html: string,
  options?: SocialParseOptions,
): Promise<ParseResult> {
  const content = extractGenericSocialText(html, platform);
  const images = extractImageUrls(html, url);
  const socialResult = await parseSocialTextRecipe(env, {
    url,
    platform,
    content,
    images,
    noContentMessage:
      "Could not extract recipe content from this social media link.",
    aiErrorCode: "AI_PARSE_FAILED",
    diagnostics: options?.diagnostics,
  });

  if (socialResult.success && !hasGenericSocialInstruction(socialResult.data)) {
    return socialResult;
  }

  const linkedRecipeResult = await tryLinkedRecipeUrls(
    extractSocialRecipeLinks([content, ...extractAnchorHrefValues(html)], url),
    options,
  );
  if (linkedRecipeResult?.success) return linkedRecipeResult;

  return socialResult;
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
    const attemptedLinkedRecipeUrls = new Set<string>();
    const hasLinkedRecipeFallback = () =>
      extractSocialRecipeLinks([result.caption], url).length > 0;
    const tryLinkedRecipeFallback = async () => {
      const linkedRecipeUrls = extractSocialRecipeLinks(
        [result.caption],
        url,
      ).filter((linkedUrl) => !attemptedLinkedRecipeUrls.has(linkedUrl));

      for (const linkedUrl of linkedRecipeUrls) {
        attemptedLinkedRecipeUrls.add(linkedUrl);
      }

      return tryLinkedRecipeUrls(linkedRecipeUrls, options);
    };

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
    const bestCaption = captionEvaluation.accepted[0];
    const bestCaptionHasGenericInstruction = hasGenericSocialInstruction(
      bestCaption?.recipe ?? fallbackRecipe,
    );
    if (
      (bestCaption?.quality.score ?? 0) >= 75 &&
      (!bestCaptionHasGenericInstruction || !hasLinkedRecipeFallback())
    ) {
      const captionResult = await selectBestRecipeCandidate(
        env,
        url,
        candidates,
        {
          cache: false,
          canonicalUrl: url,
          diagnostics: socialCandidateDiagnostics(options),
          polish: true,
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

    const linkedRecipeResult = await tryLinkedRecipeFallback();
    if (linkedRecipeResult?.success) return linkedRecipeResult;

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

      const browserLinkedRecipeResult = await tryLinkedRecipeFallback();
      if (browserLinkedRecipeResult?.success) return browserLinkedRecipeResult;

      const enrichment = await enrichSocialMediaRecipeText(env.AI, {
        platform: "tiktok",
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
        polish: true,
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
