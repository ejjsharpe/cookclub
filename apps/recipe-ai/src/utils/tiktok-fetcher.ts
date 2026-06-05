import { readLimitedText, validateFetchUrl } from "./html-fetcher";

interface TikTokOembedResponse {
  title?: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
}

export interface TikTokContent {
  caption: string | null;
  images: string[];
  subtitleUrls: string[];
  transcript: string | null;
}

interface TikTokHydrationContent {
  caption: string | null;
  images: string[];
  subtitleUrls: string[];
}

const MAX_TIKTOK_HTML_BYTES = 2 * 1024 * 1024;
const MAX_SUBTITLE_BYTES = 512 * 1024;

function uniqueStrings(values: (string | null | undefined)[]): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value))),
  );
}

function selectPrimaryTikTokImages(
  thumbnailUrl: string | null | undefined,
  hydrationImages: string[],
): string[] {
  const candidates = uniqueStrings([thumbnailUrl, ...hydrationImages]);
  return candidates.slice(0, 1);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractUniversalDataJson(html: string): unknown | null {
  const match = html.match(
    /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!match?.[1]) return null;

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function getTikTokItemStruct(data: unknown): Record<string, any> | null {
  if (!data || typeof data !== "object") return null;

  const scope = (data as Record<string, any>)["__DEFAULT_SCOPE__"];
  const details = [
    scope?.["webapp.reflow.video.detail"],
    scope?.["webapp.video-detail"],
  ];
  const item = details
    .map((detail) => detail?.itemInfo?.itemStruct)
    .find((candidate) => candidate && typeof candidate === "object");

  return item && typeof item === "object" ? item : null;
}

function getTikTokCaption(item: Record<string, any>): string | null {
  if (Array.isArray(item.contents)) {
    const contentCaption = item.contents
      .map((content: Record<string, unknown>) =>
        typeof content.desc === "string" ? content.desc.trim() : "",
      )
      .join("\n")
      .trim();

    if (contentCaption) return contentCaption;
  }

  return typeof item.desc === "string" ? item.desc : null;
}

function extractHydrationContent(html: string): TikTokHydrationContent | null {
  const item = getTikTokItemStruct(extractUniversalDataJson(html));
  if (!item) return null;

  const video = item.video && typeof item.video === "object" ? item.video : {};
  const subtitles = Array.isArray(video.subtitleInfos)
    ? video.subtitleInfos
    : [];

  return {
    caption: getTikTokCaption(item),
    images: uniqueStrings([
      video.cover,
      video.originCover,
      video.dynamicCover,
      video.reflowCover,
      ...(Array.isArray(video.shareCover) ? video.shareCover : []),
    ]),
    subtitleUrls: uniqueStrings(
      subtitles.map((subtitle: Record<string, unknown>) =>
        typeof subtitle.Url === "string" ? subtitle.Url : null,
      ),
    ),
  };
}

function parseWebVttTranscript(vtt: string): string | null {
  const lines = vtt
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .filter((line) => line !== "WEBVTT")
    .filter((line) => !line.includes("-->"))
    .filter((line) => !/^\d+$/.test(line));

  const transcript = normalizeText(lines.join(" "));
  return transcript || null;
}

async function fetchSubtitleTranscript(
  subtitleUrls: string[],
): Promise<string | null> {
  const transcripts: string[] = [];

  for (const subtitleUrl of subtitleUrls.slice(0, 2)) {
    try {
      const response = await fetch(subtitleUrl, {
        signal: AbortSignal.timeout(10_000),
        headers: {
          Accept: "text/vtt,text/plain,*/*;q=0.8",
          Referer: "https://www.tiktok.com/",
          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        },
      });
      if (!response.ok) continue;

      const transcript = parseWebVttTranscript(
        await readLimitedText(response, MAX_SUBTITLE_BYTES),
      );
      if (transcript) transcripts.push(transcript);
    } catch (error) {
      console.log(
        "TikTok subtitle fetch failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  return uniqueStrings(transcripts).join("\n") || null;
}

async function fetchHydrationContent(
  url: string,
): Promise<TikTokHydrationContent | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      },
    });
    if (!response.ok) return null;

    const readText = (response as { text?: () => Promise<string> }).text;
    if (typeof readText !== "function") return null;

    if (response.body) {
      return extractHydrationContent(
        await readLimitedText(response, MAX_TIKTOK_HTML_BYTES),
      );
    }

    return extractHydrationContent(await readText.call(response));
  } catch (error) {
    console.log(
      "TikTok hydration fetch failed:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Extract recipe content from TikTok using the oembed API.
 */
export async function extractTikTokContent(
  url: string,
): Promise<TikTokContent> {
  validateFetchUrl(url);
  // Normalize URL - oembed API only accepts /video/ format
  const normalizedUrl = url.replace(/\/(photo|reel)\//, "/video/");
  const cleanUrl = normalizedUrl.split("?")[0] ?? normalizedUrl;

  const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(cleanUrl)}`;

  const response = await fetch(oembedUrl, {
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`TikTok oembed API returned ${response.status}`);
  }

  const data = (await response.json()) as TikTokOembedResponse;

  const hydration = await fetchHydrationContent(cleanUrl);
  const subtitleUrls = uniqueStrings(hydration?.subtitleUrls ?? []);
  const transcript = await fetchSubtitleTranscript(subtitleUrls);

  return {
    caption: hydration?.caption || data.title || null,
    images: selectPrimaryTikTokImages(
      data.thumbnail_url,
      hydration?.images ?? [],
    ),
    subtitleUrls,
    transcript,
  };
}
