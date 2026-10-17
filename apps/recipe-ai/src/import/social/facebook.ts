import { FACEBOOK_IMPORT_HOSTS } from "@repo/contracts/recipe-import";
import * as cheerio from "cheerio";

import {
  ProviderRequestError,
  providerResponseError,
} from "../../services/provider-response";
import {
  readLimitedBytes,
  readLimitedText,
  validateFetchUrl,
} from "../url/fetch";

const USER_AGENT =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export interface FacebookContent {
  id: string;
  kind: "video" | "post" | "photo";
  canonicalUrl: string;
  caption: string | null;
  images: string[];
  comments: string[];
  links: string[];
  captionsUrl?: string;
  audioUrl?: string;
}

export class FacebookSourceError extends ProviderRequestError {
  constructor(
    message: string,
    readonly code: "FACEBOOK_UNSUPPORTED_URL" | "FACEBOOK_SOURCE_UNAVAILABLE",
  ) {
    super(message, { provider: "Facebook", retryable: false });
  }
}

function hostnameMatches(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`);
}

function facebookUrl(value: string): URL {
  const url = validateFetchUrl(value);
  url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !FACEBOOK_IMPORT_HOSTS.some((host) => hostnameMatches(url.hostname, host))
  ) {
    throw new FacebookSourceError(
      "Unsupported Facebook URL.",
      "FACEBOOK_UNSUPPORTED_URL",
    );
  }
  url.protocol = "https:";
  url.hash = "";
  return url;
}

export function facebookContentIdentity(
  value: string,
): { id: string; kind: FacebookContent["kind"] } | null {
  try {
    const url = facebookUrl(value);
    const path = url.pathname;
    const video =
      path.match(/^\/reels?\/(\d+)\/?$/i)?.[1] ??
      path.match(/^\/[^/]+\/videos\/(?:[^/]+\/)?(\d+)\/?$/i)?.[1] ??
      (/^\/(?:watch\/?|video\.php)$/i.test(path)
        ? url.searchParams.get("v")
        : null);
    if (video && /^\d+$/.test(video)) return { id: video, kind: "video" };
    const photo = /^\/photo(?:\.php)?\/?$/i.test(path)
      ? url.searchParams.get("fbid")
      : path.match(/^\/[^/]+\/photos\/(?:[^/]+\/)*(\d+)\/?$/i)?.[1];
    if (photo && /^\d+$/.test(photo)) return { id: photo, kind: "photo" };
    const post =
      path.match(
        /^\/(?:[^/]+\/posts|groups\/[^/]+\/(?:posts|permalink))\/([\w]+)\/?$/i,
      )?.[1] ??
      (/^\/(?:permalink|story)\.php$/i.test(path)
        ? url.searchParams.get("story_fbid")
        : null);
    return post && /^(?:\d+|pfbid\w+)$/.test(post)
      ? { id: post, kind: "post" }
      : null;
  } catch {
    return null;
  }
}

function isShareUrl(url: URL) {
  return (
    hostnameMatches(url.hostname, "fb.watch") ||
    /^\/share\/(?:[rvp]\/)?[\w-]+\/?$/i.test(url.pathname)
  );
}

export function normalizeFacebookUrl(value: string): string {
  const url = facebookUrl(value);
  if (!facebookContentIdentity(url.toString()) && !isShareUrl(url)) {
    throw new FacebookSourceError(
      "Use a link to an individual Facebook post, photo or video.",
      "FACEBOOK_UNSUPPORTED_URL",
    );
  }
  if (!hostnameMatches(url.hostname, "fb.watch")) {
    url.hostname = "www.facebook.com";
  }
  for (const key of [...url.searchParams.keys()]) {
    if (!["v", "fbid", "story_fbid", "id"].includes(key)) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  return url.toString();
}

function mediaUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = validateFetchUrl(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) {
      return undefined;
    }
    if (
      hostnameMatches(url.hostname, "fbcdn.net") ||
      url.hostname === "lookaside.fbsbx.com"
    ) {
      return url.toString();
    }
  } catch {
    /* Ignore untrusted media destinations. */
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nestedValue(value: unknown, ...keys: string[]): unknown {
  for (const key of keys) value = asRecord(value)?.[key];
  return value;
}

function* walkRecords(value: unknown): Generator<Record<string, unknown>> {
  const stack = [value];
  while (stack.length) {
    const current = stack.pop();
    if (Array.isArray(current)) {
      for (let i = current.length - 1; i >= 0; i--) stack.push(current[i]);
    } else {
      const item = asRecord(current);
      if (!item) continue;
      yield item;
      for (const child of Object.values(item).reverse()) {
        if (child && typeof child === "object") stack.push(child);
      }
    }
  }
}

function matchesId(value: unknown, id: string): boolean {
  if (value === id) return true;
  if (typeof value !== "string") return false;
  if (value.endsWith(`_${id}`)) return true;
  try {
    return atob(value).endsWith(`:${id}`);
  } catch {
    return false;
  }
}

function matchesContent(item: Record<string, unknown>, id: string): boolean {
  if (
    [item.id, item.post_id, item.videoId, item.legacy_fbid].some((value) =>
      matchesId(value, id),
    )
  ) {
    return true;
  }
  return [item.url, item.permalink_url].some(
    (url) => typeof url === "string" && facebookContentIdentity(url)?.id === id,
  );
}

function audioFromManifest(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const $ = cheerio.load(value, { xmlMode: true });
  for (const element of $(
    'AdaptationSet[contentType="audio"] BaseURL, Representation[mimeType^="audio/"] BaseURL',
  ).toArray()) {
    const url = mediaUrl($(element).text().trim());
    if (url) return url;
  }
  return undefined;
}

/** Parse only the requested post's public data; never execute Facebook scripts. */
export function parseFacebookHtml(
  html: string,
  sourceUrl: string,
): FacebookContent {
  const $ = cheerio.load(html);
  const metaUrl = $('meta[property="og:url"]').attr("content");
  const requested = facebookContentIdentity(sourceUrl);
  const metaIdentity = metaUrl ? facebookContentIdentity(metaUrl) : null;
  const identity = requested ?? metaIdentity;
  if (
    !identity ||
    (requested && metaIdentity && requested.id !== metaIdentity.id)
  ) {
    throw new FacebookSourceError(
      "Facebook did not expose the requested public post.",
      "FACEBOOK_SOURCE_UNAVAILABLE",
    );
  }
  const canonicalUrl = normalizeFacebookUrl(
    metaIdentity?.id === identity.id && metaUrl ? metaUrl : sourceUrl,
  );
  const targets: Record<string, unknown>[] = [];
  for (const script of $('script[type="application/json"]').toArray()) {
    try {
      for (const item of walkRecords(JSON.parse($(script).text()))) {
        if (matchesContent(item, identity.id)) targets.push(item);
      }
    } catch {
      /* Facebook also emits unrelated or incomplete data scripts. */
    }
  }
  if (!targets.length && metaIdentity?.id !== identity.id) {
    throw new FacebookSourceError(
      "This Facebook post is unavailable or requires login.",
      "FACEBOOK_SOURCE_UNAVAILABLE",
    );
  }
  const captions = new Set<string>();
  const images = new Set<string>();
  const links = new Set<string>();
  const comments: { text: string; creator: boolean }[] = [];
  const authorIds = new Set<string>();
  let audioUrl: string | undefined;
  let captionsUrl: string | undefined;
  const addImage = (value: unknown) => {
    const url = mediaUrl(value);
    if (url) images.add(url);
  };
  const stories = targets.flatMap((item) =>
    [item, asRecord(item.creation_story)].filter(
      (story): story is Record<string, unknown> => story !== null,
    ),
  );
  for (const item of stories) {
    for (const actor of [
      asRecord(item.owner),
      ...(Array.isArray(item.actors) ? item.actors.map(asRecord) : []),
    ]) {
      if (!actor) continue;
      if (typeof actor.id === "string") authorIds.add(actor.id);
    }
  }
  for (const item of stories) {
    for (const message of [
      item.message,
      item.caption,
      nestedValue(item, "comet_sections", "message", "story", "message"),
    ]) {
      const text = nestedValue(message, "text");
      if (typeof text === "string" && text.trim()) captions.add(text.trim());
      for (const entry of walkRecords(message)) {
        if (typeof entry.url === "string") links.add(entry.url);
      }
    }
    addImage(nestedValue(item, "preferred_thumbnail", "image", "uri"));
    if (identity.kind === "photo" || item.__typename === "Photo") {
      addImage(nestedValue(item, "image", "uri"));
      addImage(nestedValue(item, "photo_image", "uri"));
    }
    // Attachments are scoped to the selected story, not the surrounding feed.
    for (const attachment of walkRecords(item.attachments)) {
      if (attachment.__typename === "Photo") {
        addImage(nestedValue(attachment, "image", "uri"));
        addImage(nestedValue(attachment, "photo_image", "uri"));
      }
      if (typeof attachment.url === "string") links.add(attachment.url);
    }
    captionsUrl ??= mediaUrl(item.captions_url);
    audioUrl ??= audioFromManifest(
      nestedValue(
        item,
        "videoDeliveryLegacyFields",
        "dash_manifest_xml_string",
      ) ?? item.dash_manifest,
    );
    for (const feedback of [
      item.feedback,
      nestedValue(item, "comet_sections", "feedback", "story", "feedback"),
    ]) {
      for (const comment of walkRecords(feedback)) {
        const text = nestedValue(comment, "body", "text");
        if (typeof text !== "string") continue;
        const hasRecipeLink =
          /\brecipe\b/i.test(text) && /https?:\/\//i.test(text);
        if (!hasFacebookRecipeEvidence(text) && !hasRecipeLink) continue;
        const author = nestedValue(comment, "author", "id");
        comments.push({
          text,
          creator: typeof author === "string" && authorIds.has(author),
        });
      }
    }
  }
  // Preview descriptions can be truncated. Never replace a full story message with one.
  const caption =
    [...captions].sort((a, b) => b.length - a.length)[0] ??
    (metaIdentity?.id === identity.id
      ? $('meta[property="og:description"]').attr("content")
      : null) ??
    null;
  if (!images.size && metaIdentity?.id === identity.id) {
    addImage($('meta[property="og:image"]').attr("content"));
  }
  return {
    ...identity,
    canonicalUrl,
    caption,
    images: [...images],
    links: [...links],
    comments: [
      ...new Set(
        comments
          .sort((a, b) => Number(b.creator) - Number(a.creator))
          .map((comment) => comment.text),
      ),
    ].slice(0, 5),
    captionsUrl,
    audioUrl,
  };
}

/** Reject music/engagement-only text before asking an LLM to construct a recipe. */
export function hasFacebookRecipeEvidence(
  text: string | null | undefined,
): boolean {
  if (!text) return false;
  const clean = text.replace(/#[\p{L}\p{N}_]+/gu, "");
  return (
    /\b(?:ingredients?|\d+(?:[./–-]\d+)?\s*(?:cups?|tbsp|tsp|grams?|kg|ml|oz))\b/i.test(
      clean,
    ) ||
    /\b(?:add|bake|boil|chop|cut|fold|fry|heat|mix|pour|roast|roll|simmer|stir|whisk|blend|knead|sprinkle)\b[\s\S]{0,100}\b(?:flour|butter|water|salt|oil|sugar|dough|potatoes|tomatoes|onion|garlic|pepper|batter|sauce|bread|cheese|milk|eggs?|pasta|rice|bowl|pan|oven|minutes?)\b/i.test(
      clean,
    )
  );
}

export function hasWrittenFacebookRecipe(text: string): boolean {
  const lines = text.split(/\r?\n/);
  const ingredientLines = lines.filter((line) =>
    /^\s*[-*•]\s*\S/.test(line),
  ).length;
  const method = text.match(
    /\b(?:instructions?|directions?|method|how to make[^\n]*|preparation)\b\s*:?\s*([\s\S]*)/i,
  )?.[1];
  return ingredientLines >= 2 && hasFacebookRecipeEvidence(method);
}

async function checkedResponse(
  url: string,
  signal: AbortSignal,
): Promise<Response> {
  const response = await fetch(url, {
    redirect: "manual",
    signal,
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://www.facebook.com/",
    },
  });
  if (!response.ok && !(response.status >= 300 && response.status < 400)) {
    throw await providerResponseError(response, "Facebook");
  }
  return response;
}

export async function extractFacebookContent(
  value: string,
): Promise<FacebookContent> {
  let url = normalizeFacebookUrl(value);
  const requested = facebookContentIdentity(url);
  const signal = AbortSignal.timeout(25_000);
  for (let count = 0; count <= MAX_REDIRECTS; count++) {
    const response = await checkedResponse(url, signal);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location || count === MAX_REDIRECTS) {
        throw new FacebookSourceError(
          "Facebook returned too many redirects.",
          "FACEBOOK_SOURCE_UNAVAILABLE",
        );
      }
      const next = facebookUrl(new URL(location, url).toString());
      if (/^\/(?:login|checkpoint|recover)(?:[/.]|$)/i.test(next.pathname)) {
        throw new FacebookSourceError(
          "This Facebook post requires login.",
          "FACEBOOK_SOURCE_UNAVAILABLE",
        );
      }
      url = normalizeFacebookUrl(next.toString());
      continue;
    }
    const type = response.headers.get("content-type")?.split(";")[0]?.trim();
    if (type && !["text/html", "application/xhtml+xml"].includes(type)) {
      throw new FacebookSourceError(
        "Facebook returned an unsupported page.",
        "FACEBOOK_SOURCE_UNAVAILABLE",
      );
    }
    const content = parseFacebookHtml(
      await readLimitedText(response, MAX_HTML_BYTES),
      url,
    );
    if (requested && requested.id !== content.id) {
      throw new FacebookSourceError(
        "Facebook redirected to a different post.",
        "FACEBOOK_SOURCE_UNAVAILABLE",
      );
    }
    return content;
  }
  throw new FacebookSourceError(
    "Facebook post unavailable.",
    "FACEBOOK_SOURCE_UNAVAILABLE",
  );
}

export async function fetchFacebookMedia(
  value: string,
  kind: "audio" | "captions",
): Promise<Uint8Array> {
  const initialUrl = mediaUrl(value);
  if (!initialUrl) {
    throw new FacebookSourceError(
      "Facebook media is not on an approved CDN.",
      "FACEBOOK_SOURCE_UNAVAILABLE",
    );
  }
  let url: string = initialUrl;
  const signal = AbortSignal.timeout(15_000);
  for (let count = 0; count <= 2; count++) {
    const response = await checkedResponse(url, signal);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      const next = location
        ? mediaUrl(new URL(location, url).toString())
        : undefined;
      if (!next || count === 2) {
        throw new FacebookSourceError(
          "Unsupported Facebook media redirect.",
          "FACEBOOK_SOURCE_UNAVAILABLE",
        );
      }
      url = next;
      continue;
    }
    const contentType =
      response.headers
        .get("content-type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase() ?? "application/octet-stream";
    const allowed =
      kind === "audio"
        ? [
            "audio/mp4",
            "audio/m4a",
            "audio/x-m4a",
            "video/mp4",
            "application/octet-stream",
          ]
        : [
            "text/plain",
            "text/srt",
            "text/vtt",
            "application/x-subrip",
            "application/octet-stream",
          ];
    if (!allowed.includes(contentType)) {
      throw new FacebookSourceError(
        "Unsupported Facebook media type.",
        "FACEBOOK_SOURCE_UNAVAILABLE",
      );
    }
    return readLimitedBytes(
      response,
      kind === "captions" ? 256 * 1024 : 4 * 1024 * 1024,
    );
  }
  throw new FacebookSourceError(
    "Facebook media unavailable.",
    "FACEBOOK_SOURCE_UNAVAILABLE",
  );
}

export function parseFacebookSubtitles(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n\s*\r?\n/)
    .filter(
      (block) =>
        block.includes("-->") && !/^(?:NOTE|STYLE|REGION)\b/.test(block.trim()),
    )
    .map((block) =>
      block
        .slice(block.indexOf("\n", block.indexOf("-->")) + 1)
        .replace(/<[^>]*>/g, ""),
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
