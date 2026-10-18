import * as cheerio from "cheerio";

import {
  ProviderRequestError,
  providerResponseError,
} from "../../services/provider-response";
import { readLimitedText, validateFetchUrl } from "../url/fetch";

const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const MAX_TEXT_CHARACTERS = 40_000;
const USER_AGENT = "CookClub/1.0 (recipe import)";

export class RedditSourceError extends ProviderRequestError {
  constructor(
    message: string,
    readonly code:
      | "REDDIT_UNSUPPORTED_URL"
      | "REDDIT_SOURCE_UNAVAILABLE" = "REDDIT_SOURCE_UNAVAILABLE",
  ) {
    super(message, { provider: "Reddit", retryable: false });
  }
}

class RedditRepresentationUnavailableError extends RedditSourceError {}

export interface RedditContent {
  representation: "json" | "feed";
  galleryImageRecovery?: "recovered" | "unavailable";
  id: string;
  canonicalUrl: string;
  title: string;
  body: string;
  comments: string[];
  links: string[];
  images: string[];
  videoManifestUrl: string | null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function redditUrl(value: string): URL {
  const url = validateFetchUrl(value);
  url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    url.username ||
    url.password ||
    url.port ||
    ![
      "reddit.com",
      "www.reddit.com",
      "old.reddit.com",
      "new.reddit.com",
      "m.reddit.com",
      "np.reddit.com",
      "redd.it",
    ].includes(url.hostname)
  ) {
    throw new RedditSourceError(
      "Unsupported Reddit URL.",
      "REDDIT_UNSUPPORTED_URL",
    );
  }
  url.protocol = "https:";
  url.hash = "";
  return url;
}

export function redditPostIdentity(
  value: string,
): { id: string; commentId?: string } | null {
  try {
    const url = redditUrl(value);
    if (url.hostname === "redd.it") {
      const id = url.pathname.match(/^\/([a-z0-9]+)\/?$/i)?.[1];
      return id ? { id: id.toLowerCase() } : null;
    }
    const match = url.pathname.match(
      /^\/(?:r\/[\w]+\/)?comments\/([a-z0-9]+)(?:\/[^/]+(?:\/([a-z0-9]+))?)?\/?$/i,
    );
    const gallery = url.pathname.match(/^\/gallery\/([a-z0-9]+)\/?$/i);
    const id = match?.[1] ?? gallery?.[1];
    return id
      ? {
          id: id.toLowerCase(),
          ...(match?.[2] ? { commentId: match[2].toLowerCase() } : {}),
        }
      : null;
  } catch {
    return null;
  }
}

export function normalizeRedditUrl(value: string): string {
  const url = redditUrl(value);
  const identity = redditPostIdentity(value);
  if (identity) {
    return `https://www.reddit.com/comments/${identity.id}/${identity.commentId ? `_/${identity.commentId}/` : ""}`;
  }
  if (
    url.hostname !== "redd.it" &&
    /^\/r\/\w+\/s\/[a-z0-9]+\/?$/i.test(url.pathname)
  ) {
    url.hostname = "www.reddit.com";
    url.search = "";
    return url.toString();
  }
  throw new RedditSourceError(
    "Share an individual Reddit post or recipe comment.",
    "REDDIT_UNSUPPORTED_URL",
  );
}

export function redditMediaUrl(
  value: unknown,
  kind: "image" | "video",
): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = validateFetchUrl(value.replaceAll("&amp;", "&"));
    const hosts =
      kind === "image"
        ? ["i.redd.it", "preview.redd.it", "external-preview.redd.it"]
        : ["v.redd.it"];
    if (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      hosts.includes(url.hostname)
    )
      return url.toString();
  } catch {
    // Invalid and private media destinations are never fetched.
  }
  return null;
}

function listingChildren(value: unknown): unknown[] {
  const children = record(record(value).data).children;
  return Array.isArray(children) ? children : [];
}

function normalizeText(value: string): string {
  return value
    .replace(/^(?:\s*>)+\s?/gm, "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

function availableText(value: unknown): string {
  const result = text(value);
  return /^\[(?:removed|deleted)\]$/i.test(result) ? "" : normalizeText(result);
}

/** Evidence for extraction; missing quantities and steps are left to the existing validator. */
export function hasRedditRecipeEvidence(value: string): boolean {
  return (
    /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?ingredients?(?:\*\*)?\s*[:\n]/i.test(
      value,
    ) ||
    /\b\d+(?:[./]\d+)?\s*(?:cups?|tbsps?|tsps?|g|kg|ml|oz|lbs?|grams?|eggs?|cloves?)\b/i.test(
      value,
    ) ||
    /\b(?:mix|stir|bake|fry|boil|simmer|knead|blend|pour)\b[^.!?\n]{0,100}\b(?:flour|water|milk|butter|oil|sugar|salt|rice|dough|pan|oven|bowl)\b/i.test(
      value,
    ) ||
    ((value.match(
      /\b(?:add|mix|stir|bake|fry|boil|simmer|knead|blend|pour|stuff|drizzle)\b/gi,
    )?.length ?? 0) >= 2 &&
      /\b(?:tortilla|spinach|flour|milk|eggs?|rice|chicken|potatoes|pasta|yogh?urt)\b/i.test(
        value,
      ))
  );
}

export function hasWrittenRedditRecipe(value: string): boolean {
  return (
    hasRedditRecipeEvidence(value) &&
    /\b(?:mix|stir|bake|fry|boil|simmer|knead|blend|pour|roast|cook|whisk|chop|combine)\b/i.test(
      value,
    )
  );
}

type Comment = {
  id: string;
  author: string;
  body: string;
  stickied: boolean;
  images: string[];
};

function selectComments(
  comments: Comment[],
  author: string,
  postId: string,
  commentId?: string,
): Comment[] {
  if (commentId) {
    const selected = comments.find((comment) => comment.id === commentId);
    if (!selected)
      throw new RedditSourceError("This Reddit recipe comment is unavailable.");
    return [selected];
  }
  const validAuthor = author && author !== "[deleted]";
  const selected = comments.filter(
    (comment) => validAuthor && comment.author === author,
  );
  for (const comment of comments) {
    // Spotlight quotes the pinned recipe under its own account. Only accept a
    // pinned copy pointing back to this post, and omit it when the original is present.
    if (comment.author !== "spotlight-app" || !comment.stickied) continue;
    const urls = comment.body.match(/https?:\/\/[^\s<>\])]+/g) ?? [];
    const original = urls
      .map(redditPostIdentity)
      .find((id) => id?.id === postId && id.commentId);
    if (!original || selected.some((item) => item.id === original.commentId))
      continue;
    const quoted = comment.body
      .split("\n")
      .filter((line) => /^\s*>/.test(line))
      .join("\n");
    if (quoted) selected.push({ ...comment, body: normalizeText(quoted) });
  }
  const seen = new Set<string>();
  return selected
    .filter((comment) => {
      if (!comment.body || seen.has(comment.body)) return false;
      seen.add(comment.body);
      return true;
    })
    .slice(0, 20);
}

function galleryContent(post: Record<string, unknown>): {
  images: string[];
  captions: string[];
} {
  const images: string[] = [];
  const captions: string[] = [];
  const metadata = record(post.media_metadata);
  const items = record(post.gallery_data).items;
  for (const item of Array.isArray(items) ? items : []) {
    const entry = record(item);
    const media = record(metadata[text(entry.media_id)]);
    const image = redditMediaUrl(record(media.s).u, "image");
    if (image && media.status === "valid" && media.e === "Image")
      images.push(image);
    if (text(entry.caption)) captions.push(text(entry.caption));
    if (text(entry.outbound_url)) captions.push(text(entry.outbound_url));
  }
  if (!images.length) {
    const direct = redditMediaUrl(
      post.url_overridden_by_dest ?? post.url,
      "image",
    );
    if (direct) images.push(direct);
    const previews = record(post.preview).images;
    for (const item of Array.isArray(previews) ? previews : []) {
      const image = redditMediaUrl(record(record(item).source).url, "image");
      if (image && !images.length) images.push(image);
    }
  }
  return { images, captions };
}

function commentImages(data: Record<string, unknown>): string[] {
  const body = text(data.body);
  const metadata = record(data.media_metadata);
  const images: string[] = [];
  for (const match of body.matchAll(/!\[img\]\(([^)]+)\)/g)) {
    const media = record(metadata[match[1]!]);
    const url = redditMediaUrl(record(media.s).u, "image");
    if (url && media.e === "Image" && media.status === "valid")
      images.push(url);
  }
  return images;
}

/** Only the requested submission and its comments, never recommendations or other posts. */
// Retained for a future approved OAuth integration; the public importer uses RSS.
export function parseRedditJson(
  payload: unknown,
  sourceUrl: string,
): RedditContent {
  const identity = redditPostIdentity(sourceUrl);
  const listings = Array.isArray(payload) ? payload : [];
  const entry = listingChildren(listings[0]).find(
    (item) =>
      record(item).kind === "t3" &&
      record(record(item).data).id === identity?.id,
  );
  const post = record(record(entry).data);
  if (
    !identity ||
    !entry ||
    post.removed_by_category ||
    /^\[(?:removed|deleted)\]$/i.test(text(post.selftext))
  ) {
    throw new RedditSourceError(
      "This Reddit post is unavailable or has been removed.",
    );
  }
  const comments: Comment[] = [];
  const queue = [...listingChildren(listings[1])];
  for (let index = 0; index < queue.length && index < 500; index++) {
    const item = record(queue[index]);
    if (item.kind !== "t1") continue;
    const data = record(item.data);
    if (data.link_id !== `t3_${identity.id}`) continue;
    comments.push({
      id: text(data.id),
      author: text(data.author),
      body: text(data.body),
      stickied: data.stickied === true,
      images: commentImages(data),
    });
    queue.push(...listingChildren(data.replies));
  }
  const selected = selectComments(
    comments,
    text(post.author),
    identity.id,
    identity.commentId,
  );
  const gallery = galleryContent(post);
  const video = record(record(post.secure_media ?? post.media).reddit_video);
  const permalink = text(post.permalink);
  const canonical = permalink
    ? `https://www.reddit.com${permalink}`
    : normalizeRedditUrl(sourceUrl);
  return {
    representation: "json",
    id: identity.id,
    canonicalUrl: identity.commentId
      ? normalizeRedditUrl(sourceUrl)
      : redditPostIdentity(canonical)?.id === identity.id
        ? canonical
        : normalizeRedditUrl(sourceUrl),
    title: text(post.title),
    body: identity.commentId
      ? ""
      : [availableText(post.selftext), ...gallery.captions]
          .filter(Boolean)
          .join("\n\n")
          .slice(0, MAX_TEXT_CHARACTERS),
    comments: selected
      .map((comment) => availableText(comment.body))
      .filter(Boolean),
    links: identity.commentId
      ? []
      : [text(post.url_overridden_by_dest ?? post.url)],
    images: [
      ...new Set([
        ...(identity.commentId ? [] : gallery.images),
        ...selected.flatMap((comment) => comment.images),
      ]),
    ],
    videoManifestUrl:
      identity.commentId || video.has_audio === false
        ? null
        : redditMediaUrl(video.dash_url, "video"),
  };
}

function htmlText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style").remove();
  $("br").replaceWith("\n");
  $("li").prepend("\n- ");
  $("p, div, h1, h2, h3, blockquote").append("\n");
  $("a[href]").each((_, el) => {
    $(el).append(` (${$(el).attr("href")})`);
  });
  return $("body")
    .text()
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n/g, "\n\n")
    .trim();
}

/** Reddit's public Atom feed includes post text and comments even when JSON is blocked. */
export function parseRedditFeed(xml: string, sourceUrl: string): RedditContent {
  const identity = redditPostIdentity(sourceUrl);
  const $ = cheerio.load(xml, { xmlMode: true });
  if (!$("feed").length)
    throw new RedditRepresentationUnavailableError(
      "Reddit did not return a public feed.",
    );
  const entries = $("feed > entry").toArray().slice(0, 500);
  const post = entries.find(
    (entry) => $(entry).children("id").text() === `t3_${identity?.id}`,
  );
  if (!identity || !post)
    throw new RedditSourceError(
      "This Reddit post is unavailable or has been removed.",
    );
  const entryUrl = (entry: (typeof entries)[number]) =>
    $(entry)
      .children('link:not([rel]), link[rel="alternate"]')
      .first()
      .attr("href") ?? "";
  const canonicalUrl = entryUrl(post);
  if (redditPostIdentity(canonicalUrl)?.id !== identity.id)
    throw new RedditSourceError("Reddit returned a feed for a different post.");
  const author = (entry: (typeof entries)[number]) =>
    $(entry)
      .children("author")
      .children("name")
      .text()
      .trim()
      .replace(/^\/?u\//, "");
  const entryContent = (entry: (typeof entries)[number]) => {
    const html = cheerio.load($(entry).children('content[type="html"]').text());
    // Exclude the feed's submission attribution and navigation links from recipe text.
    const body = htmlText(html(".md").first().html() ?? "");
    const links = html("a[href]")
      .toArray()
      .map((el) => html(el).attr("href") ?? "");
    const imageUrls = [
      ...html("img[src]")
        .toArray()
        .map((el) => html(el).attr("src")),
      ...$(entry)
        .find("media\\:thumbnail")
        .toArray()
        .map((el) => $(el).attr("url")),
      ...links,
    ];
    return {
      body,
      links,
      images: imageUrls
        .map((url) => redditMediaUrl(url, "image"))
        .filter((url): url is string => Boolean(url)),
    };
  };
  const content = entryContent(post);
  if (/^\[(?:removed|deleted)\]$/i.test(content.body))
    throw new RedditSourceError(
      "This Reddit post is unavailable or has been removed.",
    );
  const comments: Comment[] = [];
  for (const entry of entries) {
    const id = $(entry).children("id").text();
    const linked = redditPostIdentity(entryUrl(entry));
    if (
      !linked?.commentId ||
      linked.id !== identity.id ||
      id !== `t1_${linked.commentId}`
    )
      continue;
    const comment = entryContent(entry);
    comments.push({
      id: linked.commentId,
      author: author(entry),
      body: comment.body,
      images: comment.images,
      // Atom does not expose pinned status, so it cannot establish a Spotlight copy.
      stickied: false,
    });
  }
  const selected = selectComments(
    comments,
    author(post),
    identity.id,
    identity.commentId,
  );
  return {
    representation: "feed",
    id: identity.id,
    canonicalUrl: identity.commentId
      ? normalizeRedditUrl(sourceUrl)
      : canonicalUrl,
    title: $(post).children("title").text().trim(),
    body: identity.commentId ? "" : content.body.slice(0, MAX_TEXT_CHARACTERS),
    comments: selected
      .map((comment) => availableText(comment.body))
      .filter(Boolean),
    links: identity.commentId ? [] : content.links,
    images: [
      ...new Set([
        ...(identity.commentId ? [] : content.images),
        ...selected.flatMap((comment) => comment.images),
      ]),
    ],
    videoManifestUrl: null,
  };
}

/** The public embed has a different DOM from the main Reddit post page. */
export function parseRedditGalleryEmbed(
  html: string,
  sourceUrl: string,
): string[] {
  const identity = redditPostIdentity(sourceUrl);
  if (!identity || identity.commentId) return [];
  const $ = cheerio.load(html);
  const post = $(`embed-event-handler[id="t3_${identity.id}"]`)
    .filter((_, element) => {
      const linked = redditPostIdentity($(element).attr("link") ?? "");
      return linked?.id === identity.id && !linked.commentId;
    })
    .first()
    .closest(`[id="t3_${identity.id}-embed-wrapper"]`);
  const images = post
    .find(`gallery-carousel[post-id="t3_${identity.id}"] img[src]`)
    .toArray()
    .map((element) => redditMediaUrl($(element).attr("src"), "image"))
    .filter((image): image is string => Boolean(image));
  return [...new Set(images)].slice(0, 3);
}

async function recoverFeedGalleryImages(
  content: RedditContent,
  signal: AbortSignal,
): Promise<RedditContent> {
  const identity = redditPostIdentity(content.canonicalUrl);
  if (
    content.images.length ||
    identity?.commentId ||
    !content.links.some((link) => {
      const linked = redditPostIdentity(link);
      return (
        linked?.id === content.id &&
        new URL(link).pathname.replace(/\/$/, "") === `/gallery/${content.id}`
      );
    })
  )
    return content;

  const endpoint = new URL(content.canonicalUrl);
  endpoint.protocol = "https:";
  endpoint.hostname = "embed.reddit.com";
  endpoint.search = "";
  endpoint.hash = "";
  try {
    const response = await fetchRedditPage(
      endpoint.toString(),
      AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
    );
    // This optional enrichment must never turn a usable text import into a failure.
    // Do not follow redirects out of the verified post's public embed.
    if (!response.ok) {
      await response.body?.cancel();
      return { ...content, galleryImageRecovery: "unavailable" };
    }
    const images = parseRedditGalleryEmbed(
      await readLimitedText(response, MAX_PAGE_BYTES),
      content.canonicalUrl,
    );
    return {
      ...content,
      images,
      galleryImageRecovery: images.length ? "recovered" : "unavailable",
    };
  } catch {
    return { ...content, galleryImageRecovery: "unavailable" };
  }
}

async function fetchRedditPage(
  url: string,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(url, {
    redirect: "manual",
    signal,
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9" },
  });
}

async function fetchPostFeed(
  url: string,
  signal: AbortSignal,
): Promise<RedditContent> {
  const identity = redditPostIdentity(url)!;
  let endpoint = new URL(`${normalizeRedditUrl(url)}.rss`);
  endpoint.search = "limit=100&sort=old";
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const response = await fetchRedditPage(endpoint.toString(), signal);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location)
        throw new RedditSourceError("Reddit returned an invalid redirect.");
      const next = redditUrl(new URL(location, endpoint).toString());
      const postUrl = new URL(next);
      postUrl.pathname = postUrl.pathname.replace(/\/\.rss$/, "/");
      const nextIdentity = redditPostIdentity(postUrl.toString());
      if (
        !next.pathname.endsWith("/.rss") ||
        nextIdentity?.id !== identity.id ||
        nextIdentity.commentId !== identity.commentId
      )
        throw new RedditSourceError("Reddit redirected to a different post.");
      endpoint = next;
      continue;
    }
    if (!response.ok) {
      const error = await providerResponseError(response, "Reddit");
      const reset = response.headers.get("x-ratelimit-reset");
      // Public feeds report their retry delay with x-ratelimit-reset rather than Retry-After.
      if (
        response.status === 429 &&
        error.retryAfterSeconds === undefined &&
        reset &&
        Number.isFinite(Number(reset)) &&
        Number(reset) >= 0
      )
        throw new ProviderRequestError(error.message, {
          ...error,
          retryAfterSeconds: Math.ceil(Number(reset)),
        });
      throw error;
    }
    const content = parseRedditFeed(
      await readLimitedText(response, MAX_PAGE_BYTES),
      url,
    );
    return recoverFeedGalleryImages(content, signal);
  }
  throw new RedditSourceError("Reddit returned too many redirects.");
}

export async function extractRedditContent(
  value: string,
): Promise<RedditContent> {
  let url = normalizeRedditUrl(value);
  const signal = AbortSignal.timeout(25_000);
  // Short shares only resolve inside Reddit; they never pass through a generic fetcher.
  for (let redirects = 0; !redditPostIdentity(url); redirects++) {
    if (redirects >= MAX_REDIRECTS)
      throw new RedditSourceError("Reddit returned too many redirects.");
    const response = await fetchRedditPage(url, signal);
    if (response.status < 300 || response.status >= 400) {
      if (!response.ok) throw await providerResponseError(response, "Reddit");
      await response.body?.cancel();
      throw new RedditSourceError("Reddit did not resolve the shared post.");
    }
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location)
      throw new RedditSourceError("Reddit returned an invalid redirect.");
    try {
      url = normalizeRedditUrl(new URL(location, url).toString());
    } catch {
      throw new RedditSourceError(
        "Reddit redirected to an unsupported destination.",
      );
    }
  }
  // Full browser permalinks and resolved share links use the same public feed.
  // Unauthenticated JSON and ordinary HTML were blocked in live checks; do not
  // spend extra requests on them or retry rate limits through another endpoint.
  return fetchPostFeed(url, signal);
}
