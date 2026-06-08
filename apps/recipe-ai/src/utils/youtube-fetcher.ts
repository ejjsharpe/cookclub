import { readLimitedText, validateFetchUrl } from "./html-fetcher";

const YOUTUBE_API_BASE_URL = "https://www.googleapis.com/youtube/v3";
const YOUTUBE_WATCH_BASE_URL = "https://www.youtube.com/watch";
const MAX_WATCH_HTML_BYTES = 2 * 1024 * 1024;
const MAX_CAPTION_BYTES = 512 * 1024;
const YOUTUBE_FETCH_TIMEOUT_MS = 10_000;

const RECIPE_KEYWORD_PATTERN =
  /\b(recipe|ingredients?|method|directions?|instructions?|serves?|full recipe|ingredient list|cook(?:ing)?|bake|roast|fry|simmer|whisk|mix)\b/i;
const EXTERNAL_URL_PATTERN = /\bhttps?:\/\/|www\./i;
const INGREDIENT_QUANTITY_PATTERN =
  /(?:^|\s)(?:\d+(?:[./]\d+)?|[1-9]\d*\s*\/\s*\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:cups?|tbsp|tablespoons?|tsp|teaspoons?|g|grams?|kg|ml|l|litres?|liters?|oz|ounces?|lb|pounds?|cloves?|cans?|packs?|pinch|handful)s?\b/i;

interface YouTubeVideosListResponse {
  items?: YouTubeVideoItem[];
}

interface YouTubeVideoItem {
  id?: string;
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
    channelId?: string;
    thumbnails?: Record<string, { url?: string; width?: number }>;
  };
  contentDetails?: Record<string, unknown>;
  status?: {
    privacyStatus?: string;
    uploadStatus?: string;
  };
}

interface YouTubeCommentThreadsResponse {
  items?: YouTubeCommentThreadItem[];
  error?: {
    code?: number;
    message?: string;
  };
}

interface YouTubeCommentThreadItem {
  snippet?: {
    topLevelComment?: {
      snippet?: {
        textDisplay?: string;
        textOriginal?: string;
        authorDisplayName?: string;
        authorChannelId?: { value?: string };
        likeCount?: number;
      };
    };
  };
}

export interface YouTubeVideoMetadata {
  videoId: string;
  canonicalUrl: string;
  title: string | null;
  description: string | null;
  channelTitle: string | null;
  channelId: string | null;
  images: string[];
}

export interface YouTubeComment {
  text: string;
  authorDisplayName: string | null;
  authorChannelId: string | null;
  likeCount: number;
  score: number;
}

export interface YouTubeCommentsResult {
  comments: YouTubeComment[];
  unavailableReason?: string;
}

function hostnameMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function cleanVideoId(value: string | null | undefined): string | null {
  const match = value?.match(/^[A-Za-z0-9_-]{11}/);
  return match?.[0] ?? null;
}

export function extractYouTubeVideoId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = validateFetchUrl(url);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  const pathParts = parsed.pathname.split("/").filter(Boolean);

  if (hostnameMatches(hostname, "youtu.be")) {
    return cleanVideoId(pathParts[0]);
  }

  if (!hostnameMatches(hostname, "youtube.com")) {
    return null;
  }

  if (parsed.pathname === "/watch") {
    return cleanVideoId(parsed.searchParams.get("v"));
  }

  if (["shorts", "embed", "v", "live"].includes(pathParts[0] ?? "")) {
    return cleanVideoId(pathParts[1]);
  }

  return null;
}

export function normalizeYouTubeUrl(url: string): string {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    throw new Error("Unsupported YouTube URL format");
  }

  return `${YOUTUBE_WATCH_BASE_URL}?v=${videoId}`;
}

function buildApiUrl(path: string, params: Record<string, string>): string {
  const url = new URL(`${YOUTUBE_API_BASE_URL}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function thumbnailImages(
  thumbnails: Record<string, { url?: string; width?: number }> | undefined,
): string[] {
  if (!thumbnails) return [];

  return Object.values(thumbnails)
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))
    .map((thumbnail) => thumbnail.url)
    .filter((url): url is string => Boolean(url));
}

export async function fetchYouTubeMetadata(
  apiKey: string,
  videoId: string,
): Promise<YouTubeVideoMetadata> {
  if (!apiKey) {
    throw new Error("YOUTUBE_API_KEY is required for YouTube Smart Import.");
  }

  const response = await fetch(
    buildApiUrl("videos", {
      part: "snippet,contentDetails,status",
      id: videoId,
      key: apiKey,
    }),
    {
      signal: AbortSignal.timeout(YOUTUBE_FETCH_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    },
  );

  if (!response.ok) {
    throw new Error(`YouTube videos.list returned ${response.status}`);
  }

  const data = (await response.json()) as YouTubeVideosListResponse;
  const item = data.items?.[0];
  if (!item) {
    throw new Error("YouTube video was not found or is not public.");
  }

  const privacyStatus = item.status?.privacyStatus;
  const uploadStatus = item.status?.uploadStatus;
  if (
    privacyStatus === "private" ||
    ["deleted", "failed", "rejected"].includes(uploadStatus ?? "")
  ) {
    throw new Error("YouTube video is not available for import.");
  }

  return {
    videoId,
    canonicalUrl: `${YOUTUBE_WATCH_BASE_URL}?v=${videoId}`,
    title: item.snippet?.title?.trim() || null,
    description: item.snippet?.description?.trim() || null,
    channelTitle: item.snippet?.channelTitle?.trim() || null,
    channelId: item.snippet?.channelId?.trim() || null,
    images: thumbnailImages(item.snippet?.thumbnails),
  };
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function scoreYouTubeComment(
  text: string,
  authorChannelId: string | null,
  videoChannelId: string | null,
): number {
  let score = 0;

  if (authorChannelId && videoChannelId && authorChannelId === videoChannelId) {
    score += 50;
  }
  if (EXTERNAL_URL_PATTERN.test(text)) score += 30;
  if (RECIPE_KEYWORD_PATTERN.test(text)) score += 25;
  if (INGREDIENT_QUANTITY_PATTERN.test(text)) score += 20;
  if ((text.match(/\n|•|- /g)?.length ?? 0) >= 2) score += 10;
  if (text.length > 300) score += 5;

  return score;
}

export async function fetchYouTubeComments(
  apiKey: string,
  videoId: string,
  videoChannelId: string | null,
): Promise<YouTubeCommentsResult> {
  const response = await fetch(
    buildApiUrl("commentThreads", {
      part: "snippet",
      videoId,
      maxResults: "100",
      order: "relevance",
      textFormat: "plainText",
      key: apiKey,
    }),
    {
      signal: AbortSignal.timeout(YOUTUBE_FETCH_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    },
  );

  if (!response.ok) {
    let detail = `YouTube commentThreads.list returned ${response.status}`;
    try {
      const errorBody =
        (await response.json()) as YouTubeCommentThreadsResponse;
      detail = errorBody.error?.message || detail;
    } catch {
      // Keep the status detail when the body is not JSON.
    }

    if ([403, 404].includes(response.status)) {
      return { comments: [], unavailableReason: detail };
    }

    throw new Error(detail);
  }

  const data = (await response.json()) as YouTubeCommentThreadsResponse;
  const comments = (data.items ?? [])
    .map((item) => {
      const snippet = item.snippet?.topLevelComment?.snippet;
      const text = normalizeText(
        snippet?.textOriginal || snippet?.textDisplay || "",
      );
      if (!text) return null;

      const authorChannelId = snippet?.authorChannelId?.value ?? null;
      return {
        text,
        authorDisplayName: snippet?.authorDisplayName?.trim() || null,
        authorChannelId,
        likeCount: snippet?.likeCount ?? 0,
        score: scoreYouTubeComment(text, authorChannelId, videoChannelId),
      };
    })
    .filter((comment): comment is YouTubeComment => Boolean(comment))
    .sort((a, b) => b.score - a.score || b.likeCount - a.likeCount);

  return { comments };
}

function extractBalancedJson(source: string, marker: string): unknown | null {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return null;

  const start = source.indexOf("{", markerIndex);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index++) {
    const char = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") depth++;
    if (char === "}") depth--;

    if (depth === 0) {
      try {
        return JSON.parse(source.slice(start, index + 1));
      } catch {
        return null;
      }
    }
  }

  return null;
}

function captionTrackUrlsFromWatchHtml(html: string): string[] {
  const playerResponse = extractBalancedJson(
    html,
    "ytInitialPlayerResponse",
  ) as Record<string, any> | null;
  const tracks =
    playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!Array.isArray(tracks)) return [];

  return tracks
    .map((track: Record<string, unknown>) =>
      typeof track.baseUrl === "string" ? track.baseUrl : null,
    )
    .filter((url): url is string => Boolean(url));
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    )
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function transcriptFromJson3(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const events = (value as { events?: unknown[] }).events;
  if (!Array.isArray(events)) return null;

  const parts = events.flatMap((event) => {
    const segs = (event as { segs?: unknown[] }).segs;
    if (!Array.isArray(segs)) return [];

    return segs
      .map((seg) => ((seg as { utf8?: unknown }).utf8 ?? "").toString())
      .filter((part) => part.trim() && part !== "\n");
  });

  return normalizeTranscript(parts);
}

function transcriptFromXml(xml: string): string | null {
  const parts = Array.from(xml.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g))
    .map((match) => decodeHtmlEntities(match[1] ?? "").replace(/<[^>]+>/g, ""))
    .filter((part) => part.trim());

  return normalizeTranscript(parts);
}

function transcriptFromVtt(vtt: string): string | null {
  const parts = vtt
    .split(/\r?\n/)
    .map((line) => line.replace(/<[^>]+>/g, "").trim())
    .filter(Boolean)
    .filter((line) => line !== "WEBVTT")
    .filter((line) => !line.includes("-->"))
    .filter((line) => !/^\d+$/.test(line));

  return normalizeTranscript(parts);
}

function normalizeTranscript(parts: string[]): string | null {
  const transcript = normalizeText(parts.join(" "));
  const wordCount = transcript.split(/\s+/).filter(Boolean).length;
  return transcript.length >= 40 && wordCount >= 8 ? transcript : null;
}

function captionFetchUrls(baseUrl: string): string[] {
  try {
    const url = new URL(baseUrl);
    url.searchParams.set("fmt", "json3");
    return [url.toString(), baseUrl];
  } catch {
    return [baseUrl];
  }
}

async function fetchCaptionTranscript(baseUrl: string): Promise<string | null> {
  for (const captionUrl of captionFetchUrls(baseUrl)) {
    try {
      const response = await fetch(captionUrl, {
        signal: AbortSignal.timeout(YOUTUBE_FETCH_TIMEOUT_MS),
        headers: {
          Accept: "application/json,text/xml,text/vtt,text/plain,*/*;q=0.8",
          Referer: "https://www.youtube.com/",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
      });
      if (!response.ok) continue;

      const text = await readLimitedText(response, MAX_CAPTION_BYTES);
      let transcript: string | null = null;
      try {
        transcript = transcriptFromJson3(JSON.parse(text));
      } catch {
        transcript = null;
      }
      transcript ??= transcriptFromXml(text);
      transcript ??= transcriptFromVtt(text);

      if (transcript) return transcript;
    } catch (error) {
      console.log(
        "YouTube caption fetch failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  return null;
}

export async function fetchYouTubeTranscript(
  canonicalUrl: string,
): Promise<string | null> {
  const response = await fetch(canonicalUrl, {
    signal: AbortSignal.timeout(YOUTUBE_FETCH_TIMEOUT_MS),
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`YouTube watch page returned ${response.status}`);
  }

  const captionUrls = captionTrackUrlsFromWatchHtml(
    await readLimitedText(response, MAX_WATCH_HTML_BYTES),
  );

  for (const captionUrl of captionUrls.slice(0, 3)) {
    const transcript = await fetchCaptionTranscript(captionUrl);
    if (transcript) return transcript;
  }

  return null;
}

export function hasYouTubeRecipeEvidence(
  values: (string | null | undefined)[],
): boolean {
  const text = values.filter(Boolean).join("\n");
  if (!text.trim()) return false;

  const quantityMatches = text.match(
    new RegExp(INGREDIENT_QUANTITY_PATTERN, "gi"),
  );
  return (
    (RECIPE_KEYWORD_PATTERN.test(text) &&
      INGREDIENT_QUANTITY_PATTERN.test(text)) ||
    (quantityMatches?.length ?? 0) >= 2 ||
    /(?:^|\n)\s*(?:ingredients?|method|directions?|instructions?)\s*:/i.test(
      text,
    )
  );
}
