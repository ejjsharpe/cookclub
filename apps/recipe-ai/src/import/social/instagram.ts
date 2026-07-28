import * as cheerio from "cheerio";

import {
  readLimitedBytes,
  readLimitedText,
  validateFetchUrl,
} from "../url/fetch";

interface InstagramOembedResponse {
  version?: string;
  title?: string;
  author_name?: string;
  author_url?: string;
  author_id?: number;
  media_id?: string;
  provider_name?: string;
  provider_url?: string;
  type?: string;
  width?: number;
  height?: number;
  html?: string;
  thumbnail_url?: string;
  thumbnail_width?: number;
  thumbnail_height?: number;
}

const INSTAGRAM_OEMBED_TIMEOUT_MS = 8_000;
const INSTAGRAM_CRAWLER_TIMEOUT_MS = 10_000;
const INSTAGRAM_CRAWLER_MAX_BYTES = 1_500_000;
const INSTAGRAM_AUDIO_TIMEOUT_MS = 15_000;
const INSTAGRAM_AUDIO_MAX_BYTES = 4 * 1024 * 1024;
const INSTAGRAM_AUDIO_MAX_REDIRECTS = 2;
const INSTAGRAM_CRAWLER_USER_AGENT =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const INSTAGRAM_CDN_DOMAINS = ["cdninstagram.com", "fbcdn.net"];

interface InstagramComment {
  text: string;
  username?: string;
  likeCount: number;
  isCreator: boolean;
}

export interface InstagramContent {
  caption: string | null;
  images: string[];
  authorName?: string;
  mediaId?: string;
}

export interface InstagramCrawlerContent extends InstagramContent {
  comments: InstagramComment[];
  audioUrl?: string;
}

/**
 * Extract recipe content from Instagram using the oembed API.
 *
 * This is much more reliable than browser rendering because:
 * - No login walls
 * - No JavaScript rendering required
 * - Returns full, clean caption text
 * - Returns thumbnail image
 * - Much faster (no Puppeteer overhead)
 */
export async function extractInstagramContent(
  url: string,
): Promise<InstagramContent> {
  validateFetchUrl(url);
  // Clean the URL - remove query params and tracking
  const cleanUrl = normalizeInstagramUrl(url);
  const oembedUrl = `https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(cleanUrl)}`;

  const response = await fetch(oembedUrl, {
    signal: AbortSignal.timeout(INSTAGRAM_OEMBED_TIMEOUT_MS),
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Instagram oembed API returned ${response.status}: ${response.statusText}`,
    );
  }

  const data = (await response.json()) as InstagramOembedResponse;

  const images: string[] = [];
  if (data.thumbnail_url) {
    images.push(data.thumbnail_url);
  }

  return {
    caption: data.title || null,
    images,
    authorName: data.author_name,
    mediaId: data.media_id,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function findMediaByShortcode(value: unknown, shortcode: string) {
  const stack: unknown[] = [value];
  let visited = 0;
  let fallback: Record<string, unknown> | null = null;

  while (stack.length && visited < 100_000) {
    const current = stack.pop();
    const record = asRecord(current);
    if (!record) continue;
    visited += 1;

    if (record.code === shortcode) {
      if (typeof record.video_dash_manifest === "string") return record;
      fallback ??= record;
    }

    stack.push(...(Array.isArray(current) ? current : Object.values(record)));
  }

  return fallback;
}

function isInstagramCdnUrl(url: string): boolean {
  const parsed = validateFetchUrl(url);
  const hostname = parsed.hostname.toLowerCase();
  return INSTAGRAM_CDN_DOMAINS.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  );
}

function extractAudioUrl(media: Record<string, unknown>): string | undefined {
  if (typeof media.video_dash_manifest !== "string") return undefined;

  const $ = cheerio.load(media.video_dash_manifest, { xmlMode: true });
  const candidates = [
    ...$('AdaptationSet[contentType="audio"] BaseURL').toArray(),
    ...$('Representation[mimeType^="audio/"] BaseURL').toArray(),
  ];

  for (const element of candidates) {
    const url = $(element).text().trim();
    if (!url) continue;

    try {
      if (isInstagramCdnUrl(url)) return url;
    } catch {
      // Ignore invalid or non-public media URLs from the untrusted payload.
    }
  }

  return undefined;
}

function commentScore(comment: InstagramComment): number {
  const text = comment.text;
  if (text.trim().length < 20) return 0;

  let score = comment.isCreator ? 60 : 0;
  score += Math.min(20, Math.floor(text.length / 80) * 4);
  if (
    /\b(?:ingredients?|instructions?|directions?|method|recipe)\b/i.test(text)
  ) {
    score += 25;
  }
  if (
    /\b\d+(?:[./]\d+)?\s*(?:g|kg|ml|l|oz|lb|cups?|tbsp|tsp|minutes?|mins?|hours?|hrs?)\b/i.test(
      text,
    )
  ) {
    score += 15;
  }
  if (
    /\b(?:add|bake|boil|cook|fold|fry|heat|mix|pour|roast|simmer|stir|whisk)\b/i.test(
      text,
    )
  ) {
    score += 10;
  }

  return score + Math.min(comment.likeCount, 20);
}

function extractCrawlerPayload(
  payload: unknown,
  shortcode: string,
): InstagramCrawlerContent | null {
  const stack: unknown[] = [payload];
  let visited = 0;

  while (stack.length && visited < 100_000) {
    const current = stack.pop();
    const record = asRecord(current);
    if (!record) continue;
    visited += 1;

    const rootMedia = asRecord(record.xig_polaris_media);
    if (rootMedia) {
      const media = findMediaByShortcode(rootMedia, shortcode);
      if (media) {
        const user = asRecord(media.user);
        const creatorUsername =
          typeof user?.username === "string" ? user.username : undefined;
        const caption = asRecord(media.caption);
        const commentsConnection = asRecord(rootMedia.comments_connection);
        const edges = Array.isArray(commentsConnection?.edges)
          ? commentsConnection.edges
          : [];
        const comments = edges
          .map((edge): InstagramComment | null => {
            const node = asRecord(asRecord(edge)?.node);
            const commentUser = asRecord(node?.user);
            if (typeof node?.text !== "string") return null;
            const username =
              typeof commentUser?.username === "string"
                ? commentUser.username
                : undefined;

            return {
              text: node.text.trim(),
              username,
              likeCount:
                typeof node.comment_like_count === "number"
                  ? node.comment_like_count
                  : 0,
              isCreator: Boolean(
                username &&
                creatorUsername &&
                username.toLowerCase() === creatorUsername.toLowerCase(),
              ),
            };
          })
          .filter((comment): comment is InstagramComment => Boolean(comment))
          .map((comment) => ({ comment, score: commentScore(comment) }))
          .filter(({ score }) => score >= 20)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map(({ comment }) => comment);

        const images =
          typeof media.display_uri === "string" ? [media.display_uri] : [];

        return {
          caption: typeof caption?.text === "string" ? caption.text : null,
          images,
          authorName: creatorUsername,
          mediaId: typeof media.pk === "string" ? media.pk : undefined,
          comments,
          audioUrl: extractAudioUrl(media),
        };
      }
    }

    stack.push(...(Array.isArray(current) ? current : Object.values(record)));
  }

  return null;
}

/**
 * Download the audio-only DASH rendition exposed by Instagram for a reel.
 * The byte cap keeps the subsequent Whisper request within Worker memory.
 */
export async function fetchInstagramReelAudio(
  audioUrl: string,
): Promise<Uint8Array> {
  if (!isInstagramCdnUrl(audioUrl)) {
    throw new Error("Instagram audio URL is not hosted on an approved CDN");
  }

  let currentUrl = audioUrl;
  for (
    let redirectCount = 0;
    redirectCount <= INSTAGRAM_AUDIO_MAX_REDIRECTS;
    redirectCount++
  ) {
    const response = await fetch(currentUrl, {
      signal: AbortSignal.timeout(INSTAGRAM_AUDIO_TIMEOUT_MS),
      redirect: "manual",
      headers: {
        Accept: "audio/mp4,audio/*;q=0.9,application/octet-stream;q=0.8",
        Referer: "https://www.instagram.com/",
        "User-Agent": INSTAGRAM_CRAWLER_USER_AGENT,
      },
    });

    if (
      response.status >= 300 &&
      response.status < 400 &&
      response.headers.has("location")
    ) {
      if (redirectCount === INSTAGRAM_AUDIO_MAX_REDIRECTS) {
        throw new Error("Instagram audio returned too many redirects");
      }

      const nextUrl = new URL(response.headers.get("location")!, currentUrl);
      if (!isInstagramCdnUrl(nextUrl.toString())) {
        throw new Error("Instagram audio redirected to an unsupported host");
      }
      currentUrl = nextUrl.toString();
      continue;
    }

    if (!response.ok) {
      throw new Error(
        `Instagram audio returned ${response.status}: ${response.statusText}`,
      );
    }

    const contentType = response.headers.get("content-type")?.toLowerCase();
    if (
      contentType &&
      !contentType.startsWith("audio/") &&
      !contentType.startsWith("video/mp4") &&
      !contentType.startsWith("application/octet-stream")
    ) {
      throw new Error(`Unsupported Instagram audio type: ${contentType}`);
    }

    return readLimitedBytes(response, INSTAGRAM_AUDIO_MAX_BYTES);
  }

  throw new Error("Could not download Instagram audio");
}

/**
 * Extract the structured public payload rendered for search crawlers.
 *
 * Instagram's anonymous comments REST endpoint redirects to login, while its
 * public reel HTML includes a small comments connection for search crawlers.
 * This stays a best-effort enrichment: callers must keep the oEmbed caption
 * when the crawler payload or useful comments are unavailable.
 */
export async function extractInstagramCrawlerContent(
  url: string,
): Promise<InstagramCrawlerContent> {
  validateFetchUrl(url);
  const cleanUrl = normalizeInstagramUrl(url);
  const shortcode = extractShortcode(cleanUrl);
  if (!shortcode) throw new Error("Instagram URL does not contain a shortcode");

  const response = await fetch(cleanUrl, {
    signal: AbortSignal.timeout(INSTAGRAM_CRAWLER_TIMEOUT_MS),
    redirect: "manual",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": INSTAGRAM_CRAWLER_USER_AGENT,
    },
  });
  if (!response.ok) {
    throw new Error(
      `Instagram crawler page returned ${response.status}: ${response.statusText}`,
    );
  }

  const html = await readLimitedText(response, INSTAGRAM_CRAWLER_MAX_BYTES);
  const $ = cheerio.load(html);
  for (const script of $('script[type="application/json"]').toArray()) {
    try {
      const content = $(script).text().trim();
      if (!content.includes("xig_polaris_media")) continue;
      const result = extractCrawlerPayload(JSON.parse(content), shortcode);
      if (result) return result;
    } catch {
      // Instagram emits many unrelated data scripts; malformed ones are noise.
    }
  }

  throw new Error("Instagram crawler page did not contain post data");
}

/**
 * Normalize Instagram URL to canonical form for oembed API.
 *
 * Handles various URL formats:
 * - https://www.instagram.com/reel/ABC123/
 * - https://instagram.com/p/ABC123/?igsh=...
 * - https://www.instagram.com/reels/ABC123/
 */
export function normalizeInstagramUrl(url: string): string {
  // Remove query params
  let cleanUrl = url.split("?")[0] ?? url;

  // Ensure trailing slash
  if (!cleanUrl.endsWith("/")) {
    cleanUrl += "/";
  }

  // Convert /reels/ to /reel/ (oembed API prefers /reel/)
  cleanUrl = cleanUrl.replace("/reels/", "/reel/");

  return cleanUrl;
}

/**
 * Extract shortcode from Instagram URL for logging/debugging.
 */
export function extractShortcode(url: string): string | null {
  const match = url.match(/\/(p|reel|reels)\/([A-Za-z0-9_-]+)/);
  return match?.[2] || null;
}
