import * as cheerio from "cheerio";

import type { Env, ParseMetadata, ParseResult } from "../types";
import type { AiExtractionOptions } from "./ai-client";
import { tryAiRecipeCandidate } from "./url-parse-utils";
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
import {
  appendFallbackPath,
  recordDiagnosticsStage,
  withDiagnostics,
} from "../utils/parse-diagnostics";
import { buildEnrichedSocialRecipeText } from "../utils/social-media-enrichment";
import { extractSocialRecipeLinks } from "../utils/social-recipe-links";
import {
  extractTikTokContent,
  type TikTokContent,
} from "../utils/tiktok-fetcher";
import {
  extractYouTubeVideoId,
  fetchYouTubeComments,
  fetchYouTubeMetadata,
  fetchYouTubeTranscript,
  hasYouTubeRecipeEvidence,
  normalizeYouTubeUrl,
  type YouTubeComment,
  type YouTubeVideoMetadata,
} from "../utils/youtube-fetcher";

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

const SOCIAL_TEXT_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
const SOCIAL_PROMPT_VARIANT = "compact_social";
const SOCIAL_MAX_TOKENS = 8192;

interface SocialParseOptions {
  diagnostics?: ParseMetadata["diagnostics"];
  parseLinkedRecipeUrl?: (url: string) => Promise<ParseResult>;
  aiOptions?: AiExtractionOptions;
}

interface LinkedRecipeAttempt {
  result: ParseResult | null;
  diagnostics: ParseMetadata["diagnostics"];
}

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

function baseMetadata(
  url: string,
  diagnostics: ParseMetadata["diagnostics"],
): ParseMetadata {
  return {
    source: "url",
    confidence: "low",
    canonicalUrl: url,
    diagnostics,
  };
}

function failSocialParse(
  url: string,
  diagnostics: ParseMetadata["diagnostics"],
  code: string,
  message: string,
): ParseResult {
  return {
    success: false,
    error: { code, message },
    metadata: baseMetadata(url, diagnostics),
  };
}

function socialResultWithDiagnostics(
  result: ParseResult,
  url: string,
  diagnostics: ParseMetadata["diagnostics"],
): ParseResult {
  if (!result.success) {
    return withDiagnostics(result, "url", diagnostics ?? {});
  }

  return {
    ...result,
    data: {
      ...result.data,
      sourceType: result.data.sourceType ?? "url",
      sourceUrl: result.data.sourceUrl ?? result.metadata.canonicalUrl ?? url,
    },
    metadata: {
      ...result.metadata,
      source: "url",
      canonicalUrl: result.metadata.canonicalUrl ?? url,
      diagnostics: {
        ...(diagnostics ?? {}),
        selectedAttempt:
          diagnostics?.selectedAttempt ??
          result.metadata.parseMethod ??
          result.metadata.diagnostics?.selectedAttempt,
        qualityScore:
          diagnostics?.qualityScore ??
          result.metadata.diagnostics?.qualityScore,
      },
    },
  };
}

async function tryLinkedRecipeUrls(
  urls: string[],
  diagnostics: ParseMetadata["diagnostics"],
  options?: SocialParseOptions,
): Promise<LinkedRecipeAttempt> {
  if (!options?.parseLinkedRecipeUrl || urls.length === 0) {
    return { result: null, diagnostics };
  }

  const linkedStart = Date.now();
  let lastError: unknown = null;

  for (const [index, url] of urls.entries()) {
    try {
      console.log(`[social] Trying linked recipe URL: ${url}`);
      const result = await options.parseLinkedRecipeUrl(url);
      if (!result.success) {
        lastError = result.error.message;
        console.log("[social] Linked recipe URL did not parse:", {
          url,
          code: result.error.code,
          message: result.error.message,
        });
        continue;
      }

      const nextDiagnostics = recordDiagnosticsStage(
        appendFallbackPath(diagnostics, "linked_url"),
        "linked_url",
        linkedStart,
        "success",
        result.metadata.canonicalUrl ?? url,
      );
      return {
        result: socialResultWithDiagnostics(result, url, {
          ...nextDiagnostics,
          selectedAttempt:
            result.metadata.parseMethod ?? `linked-recipe-${index + 1}`,
          qualityScore: result.metadata.diagnostics?.qualityScore,
        }),
        diagnostics: nextDiagnostics,
      };
    } catch (error) {
      lastError = error;
      console.log(
        "[social] Linked recipe URL parse failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  return {
    result: null,
    diagnostics: recordDiagnosticsStage(
      appendFallbackPath(diagnostics, "linked_url"),
      "linked_url",
      linkedStart,
      "error",
      lastError instanceof Error
        ? lastError.message
        : `${urls.length}_candidate(s)_failed`,
    ),
  };
}

async function parseSocialAi(
  env: Env,
  options: {
    url: string;
    platform: SocialPlatform;
    content: string | null;
    images: string[];
    parseMethod: "ai_only" | "media_enriched";
    diagnostics: ParseMetadata["diagnostics"];
    noContentMessage: string;
    aiErrorCode: string;
    aiOptions?: AiExtractionOptions;
  },
): Promise<ParseResult> {
  const aiStart = Date.now();
  if (!options.content || options.content.trim().length < 50) {
    const diagnostics = recordDiagnosticsStage(
      appendFallbackPath(options.diagnostics, "ai"),
      "ai",
      aiStart,
      "skipped",
      "no_content",
    );
    return failSocialParse(
      options.url,
      diagnostics,
      "NO_CONTENT",
      options.noContentMessage,
    );
  }

  const aiAttempt = await tryAiRecipeCandidate(
    env,
    options.url,
    options.content,
    options.images,
    "social_ai",
    options.parseMethod,
    `[${options.platform}]`,
    {
      cache: false,
      textModel: SOCIAL_TEXT_MODEL,
      promptVariant: SOCIAL_PROMPT_VARIANT,
      maxTokens: SOCIAL_MAX_TOKENS,
      ...options.aiOptions,
    },
  );

  const diagnostics = recordDiagnosticsStage(
    appendFallbackPath(options.diagnostics, "ai"),
    "ai",
    aiStart,
    aiAttempt.error
      ? "error"
      : aiAttempt.result?.success
        ? "success"
        : "skipped",
    options.parseMethod,
  );

  if (aiAttempt.result?.success) {
    return socialResultWithDiagnostics(aiAttempt.result, options.url, {
      ...diagnostics,
      selectedAttempt: options.parseMethod,
    });
  }

  return failSocialParse(
    options.url,
    diagnostics,
    aiAttempt.error ? options.aiErrorCode : "VALIDATION_FAILED",
    aiAttempt.error instanceof Error
      ? aiAttempt.error.message
      : `Could not parse a valid recipe from this ${options.platform} content`,
  );
}

async function parseInstagramUrl(
  env: Env,
  url: string,
  options?: SocialParseOptions,
): Promise<ParseResult> {
  const shortcode = extractShortcode(url) || "unknown";
  console.log(`Parsing Instagram URL [${shortcode}]:`, url);

  let diagnostics = options?.diagnostics;
  let caption: string | null = null;
  let images: string[] = [];

  const fetchStart = Date.now();
  try {
    const oembedResult = await extractInstagramContentOembed(url);
    caption = oembedResult.caption;
    images = oembedResult.images;
    diagnostics = recordDiagnosticsStage(diagnostics, "fetch", fetchStart);
  } catch (error) {
    diagnostics = recordDiagnosticsStage(
      diagnostics,
      "fetch",
      fetchStart,
      "error",
      error instanceof Error ? error.message : "instagram_fetch_failed",
    );
  }

  const linked = await tryLinkedRecipeUrls(
    extractSocialRecipeLinks([caption], url),
    diagnostics,
    options,
  );
  diagnostics = linked.diagnostics;
  if (linked.result?.success) return linked.result;

  return parseSocialAi(env, {
    url,
    platform: "instagram",
    content: caption,
    images,
    parseMethod: "ai_only",
    diagnostics,
    noContentMessage:
      "Could not extract recipe content from Instagram. The post may not contain a recipe or may require login to view.",
    aiErrorCode: "INSTAGRAM_PARSE_FAILED",
    aiOptions: options?.aiOptions,
  });
}

async function parseTikTokUrl(
  env: Env,
  url: string,
  options?: SocialParseOptions,
): Promise<ParseResult> {
  let diagnostics = options?.diagnostics;
  let result: TikTokContent = {
    caption: null,
    images: [],
    subtitleUrls: [],
    transcript: null,
  };

  const fetchStart = Date.now();
  try {
    result = await extractTikTokContent(url);
    diagnostics = recordDiagnosticsStage(diagnostics, "fetch", fetchStart);
  } catch (error) {
    diagnostics = recordDiagnosticsStage(
      diagnostics,
      "fetch",
      fetchStart,
      "error",
      error instanceof Error ? error.message : "tiktok_fetch_failed",
    );
  }

  const linked = await tryLinkedRecipeUrls(
    extractSocialRecipeLinks([result.caption], url),
    diagnostics,
    options,
  );
  diagnostics = linked.diagnostics;
  if (linked.result?.success) return linked.result;

  const hasSubtitleTranscript = Boolean(result.transcript?.trim());
  const content = hasSubtitleTranscript
    ? buildEnrichedSocialRecipeText({
        caption: result.caption,
        transcript: result.transcript,
      })
    : result.caption;

  return parseSocialAi(env, {
    url,
    platform: "tiktok",
    content,
    images: result.images,
    parseMethod: hasSubtitleTranscript ? "media_enriched" : "ai_only",
    diagnostics,
    noContentMessage:
      "Could not extract recipe content from TikTok. The video may not contain a recipe or the description may be too short.",
    aiErrorCode: "TIKTOK_PARSE_FAILED",
    aiOptions: options?.aiOptions,
  });
}

function youtubeMetadataText(
  metadata: YouTubeVideoMetadata,
  comments: YouTubeComment[],
): string {
  const parts = uniqueTextParts([
    metadata.title ? `Title: ${metadata.title}` : null,
    metadata.channelTitle ? `Channel: ${metadata.channelTitle}` : null,
    metadata.description ? `Description:\n${metadata.description}` : null,
    comments.length
      ? `Selected comments:\n${comments
          .map((comment) =>
            comment.authorDisplayName
              ? `- ${comment.authorDisplayName}: ${comment.text}`
              : `- ${comment.text}`,
          )
          .join("\n")}`
      : null,
  ]);

  return parts.join("\n\n");
}

async function parseYouTubeUrl(
  env: Env,
  url: string,
  options?: SocialParseOptions,
): Promise<ParseResult> {
  let diagnostics = options?.diagnostics;
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    return failSocialParse(
      url,
      diagnostics,
      "YOUTUBE_UNSUPPORTED_URL",
      "This YouTube URL format is not supported.",
    );
  }

  let metadata: YouTubeVideoMetadata;
  const metadataStart = Date.now();
  try {
    metadata = await fetchYouTubeMetadata(env.YOUTUBE_API_KEY, videoId);
    diagnostics = recordDiagnosticsStage(
      diagnostics,
      "youtube_metadata",
      metadataStart,
      "success",
      metadata.title ?? undefined,
    );
  } catch (error) {
    diagnostics = recordDiagnosticsStage(
      diagnostics,
      "youtube_metadata",
      metadataStart,
      "error",
      error instanceof Error ? error.message : "youtube_metadata_failed",
    );
    return failSocialParse(
      normalizeYouTubeUrl(url),
      diagnostics,
      "YOUTUBE_METADATA_FAILED",
      error instanceof Error
        ? error.message
        : "Could not read this YouTube video's metadata.",
    );
  }

  const commentsStart = Date.now();
  let comments: YouTubeComment[] = [];
  try {
    const commentResult = await fetchYouTubeComments(
      env.YOUTUBE_API_KEY,
      metadata.videoId,
      metadata.channelId,
    );
    comments = commentResult.comments.slice(0, 5);
    diagnostics = recordDiagnosticsStage(
      diagnostics,
      "youtube_comments",
      commentsStart,
      commentResult.unavailableReason ? "skipped" : "success",
      commentResult.unavailableReason ?? `${comments.length}_selected`,
    );
  } catch (error) {
    diagnostics = recordDiagnosticsStage(
      diagnostics,
      "youtube_comments",
      commentsStart,
      "error",
      error instanceof Error ? error.message : "youtube_comments_failed",
    );
  }

  const linked = await tryLinkedRecipeUrls(
    extractSocialRecipeLinks(
      [metadata.description, ...comments.map((comment) => comment.text)],
      metadata.canonicalUrl,
    ),
    diagnostics,
    options,
  );
  diagnostics = linked.diagnostics;
  if (linked.result?.success) return linked.result;

  const captionsStart = Date.now();
  let transcript: string | null = null;
  try {
    transcript = await fetchYouTubeTranscript(metadata.canonicalUrl);
    diagnostics = recordDiagnosticsStage(
      diagnostics,
      "youtube_captions",
      captionsStart,
      transcript ? "success" : "skipped",
      transcript ? "transcript" : "no_transcript",
    );
  } catch (error) {
    diagnostics = recordDiagnosticsStage(
      diagnostics,
      "youtube_captions",
      captionsStart,
      "error",
      error instanceof Error ? error.message : "youtube_captions_failed",
    );
  }

  const selectedCommentText = comments.map((comment) => comment.text);
  if (
    !hasYouTubeRecipeEvidence([
      metadata.description,
      ...selectedCommentText,
      transcript,
    ])
  ) {
    return failSocialParse(
      metadata.canonicalUrl,
      diagnostics,
      "YOUTUBE_NO_RECIPE_EVIDENCE",
      "Could not find recipe details in this YouTube video's description, comments, or captions.",
    );
  }

  const content = buildEnrichedSocialRecipeText({
    caption: youtubeMetadataText(metadata, comments),
    transcript,
  });

  return parseSocialAi(env, {
    url: metadata.canonicalUrl,
    platform: "youtube",
    content,
    images: metadata.images,
    parseMethod: transcript ? "media_enriched" : "ai_only",
    diagnostics,
    noContentMessage:
      "Could not extract recipe content from this YouTube video.",
    aiErrorCode: "YOUTUBE_PARSE_FAILED",
    aiOptions: options?.aiOptions,
  });
}

async function parseGenericSocialUrl(
  env: Env,
  url: string,
  platform: SocialPlatform,
  options?: SocialParseOptions,
): Promise<ParseResult> {
  let diagnostics = options?.diagnostics;
  let html: string;

  const fetchStart = Date.now();
  try {
    html = await fetchHtml(url, 1);
    diagnostics = recordDiagnosticsStage(diagnostics, "fetch", fetchStart);
  } catch (error) {
    diagnostics = recordDiagnosticsStage(
      diagnostics,
      "fetch",
      fetchStart,
      "error",
      error instanceof Error ? error.message : "fetch_failed",
    );
    return failSocialParse(
      url,
      diagnostics,
      "FETCH_FAILED",
      error instanceof Error
        ? error.message
        : `Failed to fetch ${platform} content`,
    );
  }

  const content = extractGenericSocialText(html, platform);
  const images = extractImageUrls(html, url);
  const linked = await tryLinkedRecipeUrls(
    extractSocialRecipeLinks([content, ...extractAnchorHrefValues(html)], url),
    diagnostics,
    options,
  );
  diagnostics = linked.diagnostics;
  if (linked.result?.success) return linked.result;

  return parseSocialAi(env, {
    url,
    platform,
    content,
    images,
    parseMethod: "ai_only",
    diagnostics,
    noContentMessage: "Could not extract recipe content from this social link.",
    aiErrorCode: "AI_PARSE_FAILED",
    aiOptions: options?.aiOptions,
  });
}

export function parseSocialUrl(
  env: Env,
  url: string,
  platform: SocialPlatform,
  options?: SocialParseOptions,
): Promise<ParseResult> {
  if (platform === "instagram") return parseInstagramUrl(env, url, options);
  if (platform === "tiktok") return parseTikTokUrl(env, url, options);
  if (platform === "youtube") return parseYouTubeUrl(env, url, options);
  return parseGenericSocialUrl(env, url, platform, options);
}
