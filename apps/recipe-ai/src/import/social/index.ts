import { FACEBOOK_IMPORT_HOSTS } from "@repo/contracts/recipe-import";
import * as cheerio from "cheerio";

import { buildEnrichedSocialRecipeText } from "./enrichment";
import {
  extractFacebookContent,
  FacebookSourceError,
  fetchFacebookMedia,
  hasFacebookRecipeEvidence,
  hasWrittenFacebookRecipe,
  parseFacebookSubtitles,
} from "./facebook";
import {
  extractInstagramCrawlerContent,
  extractInstagramContent as extractInstagramContentOembed,
  extractShortcode,
  fetchInstagramReelAudio,
  type InstagramCrawlerContent,
} from "./instagram";
import { extractSocialRecipeLinks } from "./links";
import { extractTikTokContent, type TikTokContent } from "./tiktok";
import {
  extractYouTubeVideoId,
  fetchYouTubeComments,
  fetchYouTubeMetadata,
  fetchYouTubeTranscript,
  hasYouTubeRecipeEvidence,
  normalizeYouTubeUrl,
  type YouTubeComment,
  type YouTubeVideoMetadata,
} from "./youtube";
import { transcribeGroqAudio } from "../../services/groq-audio-client";
import {
  providerFailureFields,
  providerTransportError,
} from "../../services/provider-response";
import type { Env, ParseMetadata, ParseResult } from "../../types";
import type { AiClient } from "../../utils/ai-response-parser";
import {
  appendFallbackPath,
  recordDiagnosticsStage,
  withDiagnostics,
} from "../../utils/parse-diagnostics";
import { fetchHtml } from "../url/fetch";
import {
  cleanHtml,
  extractImageUrls,
  focusRecipeContent,
} from "../url/html-cleaner";
import { tryAiRecipeCandidate } from "../url/parse";

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
  facebook: [...FACEBOOK_IMPORT_HOSTS],
  youtube: ["youtube.com", "youtu.be"],
  pinterest: ["pinterest.com", "pin.it"],
  threads: ["threads.net"],
  x: ["x.com", "twitter.com"],
  reddit: ["reddit.com"],
};

const INSTAGRAM_AUDIO_PROMPT =
  "A cooking recipe narration with ingredient names, quantities, temperatures, timings, and preparation steps.";

interface SocialParseOptions {
  diagnostics?: ParseMetadata["diagnostics"];
  parseLinkedRecipeUrl?: (url: string) => Promise<ParseResult>;
  aiClient: AiClient;
}

interface LinkedRecipeAttempt {
  result: ParseResult | null;
  diagnostics: ParseMetadata["diagnostics"];
}

function isAiJsonParseError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /Failed to parse AI response as JSON/i.test(error.message)
  );
}

function shouldRetrySocialAi(
  error: unknown,
  result: ParseResult | null,
  content: string,
): boolean {
  if (isAiJsonParseError(error)) return true;
  if (error) return false;
  if (!result?.success) {
    return /Audio transcript:\s*\S/i.test(content);
  }

  const explicitIngredientCount = countExplicitIngredientLines(content);
  if (explicitIngredientCount === 0) return false;

  const parsedIngredientCount = result.data.ingredientSections.reduce(
    (count, section) => count + section.ingredients.length,
    0,
  );
  return parsedIngredientCount < explicitIngredientCount;
}

function countExplicitIngredientLines(content: string): number {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  let inIngredients = false;
  let count = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^ingredients?\s*:?$/i.test(line)) {
      inIngredients = true;
      continue;
    }
    if (
      inIngredients &&
      /^(?:instructions?|directions?|method|steps|preparation)\s*:?$/i.test(
        line,
      )
    ) {
      break;
    }
    if (inIngredients && /^[-*•·▪▫◦]\s*\S/.test(line)) count += 1;
  }

  return count;
}

function mentionsRecipeInComments(caption: string | null): boolean {
  return Boolean(
    caption &&
    /\b(?:full\s+)?recipe(?:\s+is)?\s+(?:in|inside)\s+(?:the\s+)?comments?\b/i.test(
      caption,
    ),
  );
}

function hostnameMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function getSocialPlatform(url: string): SocialPlatform | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/\.$/, "");

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
  cause?: unknown,
): ParseResult {
  return {
    success: false,
    error: {
      code,
      message,
      ...(cause === undefined || cause === null
        ? {}
        : providerFailureFields(cause)),
    },
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
  options: SocialParseOptions,
): Promise<LinkedRecipeAttempt> {
  if (!options.parseLinkedRecipeUrl || urls.length === 0) {
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
    aiClient: AiClient;
    selectedAttempt?: string;
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
      aiClient: options.aiClient,
      extractionProfile: "social",
    },
  );

  let diagnostics = recordDiagnosticsStage(
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

  const shouldRetry = shouldRetrySocialAi(
    aiAttempt.error,
    aiAttempt.result,
    options.content,
  );

  if (aiAttempt.result?.success && !shouldRetry) {
    return socialResultWithDiagnostics(aiAttempt.result, options.url, {
      ...diagnostics,
      selectedAttempt: options.selectedAttempt ?? options.parseMethod,
    });
  }

  if (shouldRetry) {
    const retryStart = Date.now();
    const retryAttempt = await tryAiRecipeCandidate(
      env,
      options.url,
      options.content,
      options.images,
      "social_ai",
      options.parseMethod,
      `[${options.platform}:ai_retry]`,
      {
        cache: false,
        aiClient: options.aiClient,
        extractionProfile: "social",
      },
    );

    diagnostics = recordDiagnosticsStage(
      appendFallbackPath(diagnostics, "ai_retry"),
      "ai_retry",
      retryStart,
      retryAttempt.error
        ? "error"
        : retryAttempt.result?.success
          ? "success"
          : "skipped",
      "same_workload_retry",
    );

    if (retryAttempt.result?.success) {
      return socialResultWithDiagnostics(retryAttempt.result, options.url, {
        ...diagnostics,
        selectedAttempt: `${options.selectedAttempt ?? options.parseMethod}_retry`,
      });
    }

    if (aiAttempt.result?.success) {
      return socialResultWithDiagnostics(aiAttempt.result, options.url, {
        ...diagnostics,
        selectedAttempt: options.selectedAttempt ?? options.parseMethod,
      });
    }

    return failSocialParse(
      options.url,
      diagnostics,
      retryAttempt.error ? options.aiErrorCode : "VALIDATION_FAILED",
      retryAttempt.error instanceof Error
        ? retryAttempt.error.message
        : `Could not parse a valid recipe from this ${options.platform} content`,
      retryAttempt.error,
    );
  }

  return failSocialParse(
    options.url,
    diagnostics,
    aiAttempt.error ? options.aiErrorCode : "VALIDATION_FAILED",
    aiAttempt.error instanceof Error
      ? aiAttempt.error.message
      : `Could not parse a valid recipe from this ${options.platform} content`,
    aiAttempt.error,
  );
}

function isInstagramReelUrl(url: string): boolean {
  try {
    return /^\/reels?\//i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function hasRecipeInstructions(result: ParseResult): boolean {
  return (
    result.success &&
    result.data.instructionSections.some(
      (section) => section.instructions.length > 0,
    )
  );
}

function instagramRecipeContent(
  caption: string | null,
  comments: string[],
  transcript?: string | null,
) {
  return buildEnrichedSocialRecipeText({
    caption,
    pageText: comments.length
      ? `Selected public comments:\n${comments
          .map((comment, index) => `${index + 1}. ${comment}`)
          .join("\n")}`
      : null,
    transcript,
  });
}

async function transcribeInstagramAudio(
  env: Env,
  audioUrl: string,
  caption: string | null,
): Promise<string | null> {
  const audio = await fetchInstagramReelAudio(audioUrl);
  const captionContext = caption?.replace(/\s+/g, " ").trim().slice(0, 500);
  const initialPrompt = captionContext
    ? `${INSTAGRAM_AUDIO_PROMPT} Post caption context: ${captionContext}`
    : INSTAGRAM_AUDIO_PROMPT;
  const transcribe = (language?: string) =>
    transcribeGroqAudio({
      apiKey: env.GROQ_API_KEY,
      audio,
      prompt: initialPrompt,
      language,
    });

  let result;
  try {
    result = await transcribe();
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !/(?:different|multiple) languages|force a single language/i.test(
        error.message,
      )
    ) {
      throw error;
    }

    result = await transcribe("en");
  }

  const transcript = result.trim();
  return transcript.length >= 20 ? transcript : null;
}

async function parseInstagramUrl(
  env: Env,
  url: string,
  options: SocialParseOptions,
): Promise<ParseResult> {
  const shortcode = extractShortcode(url) || "unknown";
  console.log(`Parsing Instagram URL [${shortcode}]:`, url);

  let diagnostics = options.diagnostics;
  let caption: string | null = null;
  let images: string[] = [];
  let comments: string[] = [];
  let crawlerResult: InstagramCrawlerContent | null = null;

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

  const loadCrawlerContent = async (
    stageName: string,
  ): Promise<InstagramCrawlerContent | null> => {
    if (crawlerResult) return crawlerResult;

    const commentsStart = Date.now();
    try {
      crawlerResult = await extractInstagramCrawlerContent(url);
      caption ??= crawlerResult.caption;
      images = Array.from(new Set([...images, ...crawlerResult.images]));
      comments = crawlerResult.comments.map((comment) => comment.text);
      diagnostics = recordDiagnosticsStage(
        diagnostics,
        stageName,
        commentsStart,
        stageName === "instagram_comments" && comments.length === 0
          ? "skipped"
          : "success",
        `${comments.length}_comment(s),${crawlerResult.audioUrl ? "audio_found" : "no_audio"}`,
      );
      return crawlerResult;
    } catch (error) {
      diagnostics = recordDiagnosticsStage(
        diagnostics,
        stageName,
        commentsStart,
        "error",
        error instanceof Error ? error.message : "instagram_comments_failed",
      );
      return null;
    }
  };

  if (!caption || mentionsRecipeInComments(caption)) {
    await loadCrawlerContent("instagram_comments");
  }

  const initialLinkedUrls = extractSocialRecipeLinks(
    [caption, ...comments],
    url,
  );
  const linked = await tryLinkedRecipeUrls(
    initialLinkedUrls,
    diagnostics,
    options,
  );
  diagnostics = linked.diagnostics;
  if (linked.result?.success) return linked.result;

  const initialResult = await parseSocialAi(env, {
    url,
    platform: "instagram",
    content: instagramRecipeContent(caption, comments),
    images,
    parseMethod: comments.length ? "media_enriched" : "ai_only",
    diagnostics,
    noContentMessage:
      "Could not extract recipe content from Instagram. The post may not contain a recipe or may require login to view.",
    aiErrorCode: "INSTAGRAM_PARSE_FAILED",
    aiClient: options.aiClient,
  });

  if (!isInstagramReelUrl(url) || hasRecipeInstructions(initialResult)) {
    return initialResult;
  }

  diagnostics = initialResult.metadata?.diagnostics ?? diagnostics;
  const fallbackCrawlerResult = await loadCrawlerContent(
    "instagram_reel_metadata",
  );

  const fallbackLinkedUrls = extractSocialRecipeLinks(
    [caption, ...comments],
    url,
  ).filter((candidate) => !initialLinkedUrls.includes(candidate));
  const fallbackLinked = await tryLinkedRecipeUrls(
    fallbackLinkedUrls,
    diagnostics,
    options,
  );
  diagnostics = fallbackLinked.diagnostics;
  if (fallbackLinked.result?.success) return fallbackLinked.result;

  const audioUrl = fallbackCrawlerResult?.audioUrl;
  if (!audioUrl) {
    diagnostics = recordDiagnosticsStage(
      appendFallbackPath(diagnostics, "instagram_audio"),
      "instagram_audio",
      Date.now(),
      "skipped",
      "no_audio_url",
    );
    return withDiagnostics(initialResult, "url", diagnostics);
  }

  const transcriptionStart = Date.now();
  let transcript: string | null = null;
  try {
    transcript = await transcribeInstagramAudio(env, audioUrl, caption);
    diagnostics = recordDiagnosticsStage(
      appendFallbackPath(diagnostics, "instagram_audio"),
      "instagram_audio",
      transcriptionStart,
      transcript ? "success" : "skipped",
      transcript ? `${transcript.length}_characters` : "empty_transcript",
    );
  } catch (error) {
    diagnostics = recordDiagnosticsStage(
      appendFallbackPath(diagnostics, "instagram_audio"),
      "instagram_audio",
      transcriptionStart,
      "error",
      error instanceof Error ? error.message : "instagram_audio_failed",
    );
  }

  if (!transcript) {
    return withDiagnostics(initialResult, "url", diagnostics);
  }

  const audioResult = await parseSocialAi(env, {
    url,
    platform: "instagram",
    content: instagramRecipeContent(caption, comments, transcript),
    images,
    parseMethod: "media_enriched",
    selectedAttempt: "instagram_audio",
    diagnostics,
    noContentMessage:
      "Could not extract recipe content from this Instagram reel or its audio.",
    aiErrorCode: "INSTAGRAM_AUDIO_PARSE_FAILED",
    aiClient: options.aiClient,
  });

  if (
    hasRecipeInstructions(audioResult) ||
    (!initialResult.success && audioResult.success)
  ) {
    return audioResult;
  }

  const initialDiagnostics = initialResult.metadata?.diagnostics;
  return withDiagnostics(initialResult, "url", {
    ...(audioResult.metadata?.diagnostics ?? diagnostics),
    selectedAttempt: initialDiagnostics?.selectedAttempt,
    qualityScore: initialDiagnostics?.qualityScore,
  });
}

async function parseTikTokUrl(
  env: Env,
  url: string,
  options: SocialParseOptions,
): Promise<ParseResult> {
  let diagnostics = options.diagnostics;
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
    aiClient: options.aiClient,
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
  options: SocialParseOptions,
): Promise<ParseResult> {
  let diagnostics = options.diagnostics;
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
      error,
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
    aiClient: options.aiClient,
  });
}

async function parseFacebookUrl(
  env: Env,
  url: string,
  options: SocialParseOptions,
): Promise<ParseResult> {
  let diagnostics = options.diagnostics;
  const start = Date.now();
  let content;
  try {
    content = await extractFacebookContent(url);
    url = content.canonicalUrl;
    diagnostics = recordDiagnosticsStage(
      { ...diagnostics, canonicalUrl: url, platform: "facebook" },
      "facebook_fetch",
      start,
    );
  } catch (error) {
    diagnostics = recordDiagnosticsStage(
      diagnostics,
      "facebook_fetch",
      start,
      "error",
      "source_unavailable",
    );
    return failSocialParse(
      url,
      diagnostics,
      error instanceof FacebookSourceError
        ? error.code
        : "FACEBOOK_SOURCE_UNAVAILABLE",
      error instanceof FacebookSourceError
        ? error.message
        : providerTransportError(error, "Facebook").message,
      error,
    );
  }

  const writtenText = [content.caption, ...content.comments]
    .filter(Boolean)
    .join("\n\n");
  const linked = await tryLinkedRecipeUrls(
    extractSocialRecipeLinks([writtenText, ...content.links], url),
    diagnostics,
    options,
  );
  diagnostics = linked.diagnostics;
  if (linked.result?.success) return linked.result;

  let transcript: string | null = null;
  let enrichmentError: unknown;
  if (content.kind === "video" && !hasWrittenFacebookRecipe(writtenText)) {
    if (content.captionsUrl) {
      const stageStart = Date.now();
      try {
        const media = await fetchFacebookMedia(content.captionsUrl, "captions");
        const text = parseFacebookSubtitles(new TextDecoder().decode(media));
        transcript = hasFacebookRecipeEvidence(text) ? text : null;
        diagnostics = recordDiagnosticsStage(
          diagnostics,
          "facebook_subtitles",
          stageStart,
          transcript ? "success" : "skipped",
          transcript ? "recipe_evidence" : "no_recipe_evidence",
        );
      } catch (error) {
        enrichmentError = error;
        diagnostics = recordDiagnosticsStage(
          diagnostics,
          "facebook_subtitles",
          stageStart,
          "error",
          "subtitles_unavailable",
        );
      }
    }
    if (!transcript && content.audioUrl) {
      const stageStart = Date.now();
      try {
        const media = await fetchFacebookMedia(content.audioUrl, "audio");
        const text = await transcribeGroqAudio({
          apiKey: env.GROQ_API_KEY,
          audio: media,
          prompt:
            "Transcribe the speech accurately. The recording may contain cooking instructions, music or silence. Do not invent speech or recipe details.",
        });
        transcript = hasFacebookRecipeEvidence(text) ? text : null;
        enrichmentError = undefined;
        diagnostics = recordDiagnosticsStage(
          appendFallbackPath(diagnostics, "facebook_audio"),
          "facebook_audio",
          stageStart,
          transcript ? "success" : "skipped",
          transcript ? "recipe_evidence" : "no_recipe_evidence",
        );
      } catch (error) {
        enrichmentError = error;
        diagnostics = recordDiagnosticsStage(
          diagnostics,
          "facebook_audio",
          stageStart,
          "error",
          "audio_unavailable",
        );
      }
    }
  }
  if (!hasFacebookRecipeEvidence(writtenText) && !transcript) {
    if (enrichmentError) {
      return failSocialParse(
        url,
        diagnostics,
        "FACEBOOK_SOURCE_UNAVAILABLE",
        providerTransportError(enrichmentError, "Facebook").message,
        enrichmentError,
      );
    }
    return failSocialParse(
      url,
      diagnostics,
      "NO_RECIPE",
      "This public Facebook post did not expose enough recipe information.",
    );
  }
  const evidence = buildEnrichedSocialRecipeText({
    caption: content.caption,
    pageText: content.comments.join("\n\n"),
    transcript,
  });
  return parseSocialAi(env, {
    url,
    platform: "facebook",
    content: evidence,
    images: content.images.slice(0, 3),
    parseMethod:
      transcript || content.comments.length ? "media_enriched" : "ai_only",
    diagnostics,
    aiClient: options.aiClient,
    selectedAttempt: transcript ? "facebook_transcript" : "facebook_caption",
    noContentMessage:
      "Could not extract recipe information from this Facebook post.",
    aiErrorCode: "FACEBOOK_PARSE_FAILED",
  });
}

async function parseGenericSocialUrl(
  env: Env,
  url: string,
  platform: SocialPlatform,
  options: SocialParseOptions,
): Promise<ParseResult> {
  let diagnostics = options.diagnostics;
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
      error,
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
    aiClient: options.aiClient,
  });
}

export function parseSocialUrl(
  env: Env,
  url: string,
  platform: SocialPlatform,
  options: SocialParseOptions,
): Promise<ParseResult> {
  if (platform === "instagram") return parseInstagramUrl(env, url, options);
  if (platform === "tiktok") return parseTikTokUrl(env, url, options);
  if (platform === "youtube") return parseYouTubeUrl(env, url, options);
  if (platform === "facebook") return parseFacebookUrl(env, url, options);
  return parseGenericSocialUrl(env, url, platform, options);
}
