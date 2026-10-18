import { PINTEREST_IMPORT_HOSTS } from "@repo/contracts/recipe-import";
import * as cheerio from "cheerio";

import {
  ProviderRequestError,
  providerResponseError,
} from "../../services/provider-response";
import { readLimitedText, validateFetchUrl } from "../url/fetch";

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface PinterestContent {
  id: string;
  canonicalUrl: string;
  title: string | null;
  description: string | null;
  links: string[];
  images: string[];
}

export class PinterestSourceError extends ProviderRequestError {
  constructor(
    message: string,
    readonly code: "PINTEREST_UNSUPPORTED_URL" | "PINTEREST_SOURCE_UNAVAILABLE",
  ) {
    super(message, { provider: "Pinterest", retryable: false });
  }
}

function hostnameMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function pinterestUrl(value: string): URL {
  const url = validateFetchUrl(value);
  url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    url.username ||
    url.password ||
    url.port ||
    !PINTEREST_IMPORT_HOSTS.some((host) => hostnameMatches(url.hostname, host))
  ) {
    throw new PinterestSourceError(
      "Unsupported Pinterest URL.",
      "PINTEREST_UNSUPPORTED_URL",
    );
  }
  url.protocol = "https:";
  url.hash = "";
  return url;
}

export function extractPinterestPinId(value: string): string | null {
  try {
    const url = pinterestUrl(value);
    if (hostnameMatches(url.hostname, "pin.it")) return null;
    return (
      url.pathname.match(/^\/pin\/(?:[^/]+--)?(\d+)(?:\/sent)?\/?$/)?.[1] ??
      null
    );
  } catch {
    return null;
  }
}

export function normalizePinterestUrl(value: string): string {
  const url = pinterestUrl(value);
  const id = extractPinterestPinId(url.toString());
  if (id) return `https://www.pinterest.com/pin/${id}/`;
  if (url.hostname === "pin.it" && /^\/[a-z0-9]+\/?$/i.test(url.pathname)) {
    url.search = "";
    return url.toString();
  }
  throw new PinterestSourceError(
    "Share an individual Pinterest pin, rather than a profile or board.",
    "PINTEREST_UNSUPPORTED_URL",
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function* walkRecords(value: unknown): Generator<Record<string, unknown>> {
  const stack = [value];
  while (stack.length) {
    const current = stack.pop();
    if (Array.isArray(current)) {
      for (const child of current) stack.push(child);
    } else {
      const item = record(current);
      if (!item) continue;
      yield item;
      for (const child of Object.values(item)) {
        if (child && typeof child === "object") stack.push(child);
      }
    }
  }
}

function pinImage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = validateFetchUrl(value);
    if (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      hostnameMatches(url.hostname, "pinimg.com")
    )
      return url.toString();
  } catch {
    // Ignore invalid or private image destinations.
  }
  return null;
}

function parseRelayPayload(script: string): unknown {
  // Decode the JSON arguments without evaluating any page JavaScript.
  const match = script
    .trim()
    .match(/^window\.__PWS_RELAY_REGISTER_COMPLETED_REQUEST__\(([\s\S]*)\);?$/);
  if (!match) return null;
  const args: unknown[] = JSON.parse(`[${match[1]}]`);
  return args.length === 2 && typeof args[0] === "string" ? args[1] : null;
}

/** Read only the selected pin's metadata and data records, never its related feed. */
export function parsePinterestHtml(
  html: string,
  sourceUrl: string,
): PinterestContent {
  const id = extractPinterestPinId(sourceUrl);
  if (!id) {
    throw new PinterestSourceError(
      "Pinterest did not resolve to a pin.",
      "PINTEREST_SOURCE_UNAVAILABLE",
    );
  }
  const $ = cheerio.load(html);
  const meta = (name: string) => $(`meta[property="${name}"]`).attr("content");
  const pageUrls = [
    meta("og:url"),
    $('link[rel="canonical"]').attr("href"),
  ].filter((value): value is string => Boolean(value));
  const selectedPins: Record<string, unknown>[] = [];
  const structuredData: unknown[] = [];
  const pinIds = new Set([id]);
  for (const element of $(
    'script[type="application/ld+json"], script[type="application/json"], script[data-relay-completed-request="true"]',
  ).toArray()) {
    let data: unknown;
    try {
      data =
        $(element).attr("data-relay-completed-request") === "true"
          ? parseRelayPayload($(element).text())
          : JSON.parse($(element).text());
    } catch {
      continue;
    }
    if ($(element).attr("type") === "application/ld+json") {
      structuredData.push(data);
      continue;
    }
    for (const item of walkRecords(data)) {
      const legacyPin = item.id === id && (!item.type || item.type === "pin");
      const relayPin = item.entityId === id && item.__typename === "Pin";
      if (!legacyPin && !relayPin) continue;
      selectedPins.push(item);
      // Saved pins can advertise the original pin's SEO metadata. Only trust
      // this alias when the requested pin itself identifies its canonical pin.
      const pinJoin = record(item.pinJoin);
      const canonicalId = record(pinJoin?.canonicalPin)?.entityId;
      if (typeof canonicalId === "string" && /^\d+$/.test(canonicalId)) {
        pinIds.add(canonicalId);
      }
      // Pinterest's deferred payload can omit canonicalPin while still
      // identifying the original pin by its relative SEO path.
      const canonicalPath = pinJoin?.seoCanonicalUrl;
      if (
        typeof canonicalPath === "string" &&
        canonicalPath.startsWith("/pin/")
      ) {
        const seoId = extractPinterestPinId(
          `https://www.pinterest.com${canonicalPath}`,
        );
        if (seoId) pinIds.add(seoId);
      }
    }
  }
  if (
    pageUrls.some((value) => !pinIds.has(extractPinterestPinId(value) ?? ""))
  ) {
    throw new PinterestSourceError(
      "Pinterest returned a different page.",
      "PINTEREST_SOURCE_UNAVAILABLE",
    );
  }
  const verifiedMeta = pageUrls.length > 0;
  const titles = new Set<string>();
  const descriptions = new Set<string>();
  const links = new Set<string>();
  const images = new Set<string>();
  const addText = (set: Set<string>, value: unknown) => {
    if (typeof value === "string" && value.trim()) set.add(value.trim());
  };
  const addImage = (value: unknown) => {
    const url = pinImage(value);
    if (url) images.add(url);
  };
  let foundPin = selectedPins.length > 0;
  for (const data of structuredData) {
    const entries = Array.isArray(data) ? data : [data];
    const nodes = entries.flatMap((entry) => {
      const graph = record(entry)?.["@graph"];
      return Array.isArray(graph) ? graph : [entry];
    });
    for (const node of nodes) {
      const item = record(node);
      if (item?.["@type"] !== "SocialMediaPosting") continue;
      const page = item.mainEntityOfPage;
      const identity = typeof page === "string" ? page : record(page)?.["@id"];
      if (
        typeof identity === "string"
          ? !pinIds.has(extractPinterestPinId(identity) ?? "")
          : !verifiedMeta
      )
        continue;
      foundPin = true;
      addText(titles, item.headline);
      addText(descriptions, item.articleBody);
      addText(links, record(item.sharedContent)?.url);
      addImage(
        typeof item.image === "string" ? item.image : record(item.image)?.url,
      );
    }
  }
  for (const item of selectedPins) {
    addText(titles, item.title);
    addText(titles, item.grid_title);
    addText(descriptions, item.description);
    addText(links, item.link);
    const image = record(item.images);
    addImage(record(image?.orig)?.url ?? record(image?.["736x"])?.url);
    addImage(item.imageLargeUrl);
    const rich = record(item.rich_summary);
    addText(links, rich?.url);
  }
  if (!verifiedMeta && !foundPin) {
    throw new PinterestSourceError(
      "This Pinterest pin is unavailable or requires login.",
      "PINTEREST_SOURCE_UNAVAILABLE",
    );
  }
  if (verifiedMeta) {
    addText(links, meta("pinterestapp:source"));
    addText(links, meta("og:see_also"));
    if (!titles.size) addText(titles, meta("og:title"));
    addText(descriptions, meta("og:description"));
    if (!images.size) addImage(meta("og:image"));
  }
  return {
    id,
    canonicalUrl: `https://www.pinterest.com/pin/${id}/`,
    title: [...titles][0] ?? null,
    description:
      [...descriptions].sort((a, b) => b.length - a.length)[0] ?? null,
    links: [...links],
    images: [...images].slice(0, 3),
  };
}

export function hasPinterestRecipeEvidence(text: string | null): boolean {
  if (!text) return false;
  return (
    /\b\d+(?:[./–-]\d+)?\s*(?:cups?|tbsp|tsp|grams?|kg|ml|oz)\b/i.test(text) ||
    /(?:^|\n)\s*ingredients?\s*:?\s*\n\s*\S/i.test(text) ||
    /\b(?:add|bake|boil|chop|fry|mix|pour|roast|simmer|stir|whisk|blend|knead)\b[\s\S]{0,80}\b(?:flour|butter|water|salt|oil|sugar|dough|onion|garlic|batter|sauce|cheese|milk|eggs?|pasta|rice|bowl|pan|oven)\b/i.test(
      text,
    )
  );
}

export async function extractPinterestContent(
  value: string,
): Promise<PinterestContent> {
  let url = normalizePinterestUrl(value);
  let requestedId = extractPinterestPinId(url);
  const signal = AbortSignal.timeout(25_000);
  for (let count = 0; count <= MAX_REDIRECTS; count++) {
    const response = await fetch(url, {
      redirect: "manual",
      signal,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location || count === MAX_REDIRECTS) {
        throw new PinterestSourceError(
          "Pinterest returned too many redirects.",
          "PINTEREST_SOURCE_UNAVAILABLE",
        );
      }
      try {
        const next = pinterestUrl(new URL(location, url).toString());
        const nextId = extractPinterestPinId(next.toString());
        if (requestedId && nextId && requestedId !== nextId) {
          throw new Error("Different pin");
        }
        requestedId ??= nextId;
        if (nextId) {
          // Keep regional redirects on their chosen host to avoid geo-redirect loops.
          next.pathname = `/pin/${nextId}/`;
          next.search = "";
          url = next.toString();
          continue;
        }
        // pin.it may pass through Pinterest's own short-link resolver.
        url =
          next.hostname === "api.pinterest.com" &&
          /^\/url_shortener\/[a-z0-9]+\/(?:redirect\/?)?$/i.test(next.pathname)
            ? next.toString()
            : normalizePinterestUrl(next.toString());
      } catch {
        throw new PinterestSourceError(
          "Pinterest redirected to an unavailable or unsupported pin.",
          "PINTEREST_SOURCE_UNAVAILABLE",
        );
      }
      continue;
    }
    if (!response.ok) throw await providerResponseError(response, "Pinterest");
    const type = response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase();
    if (type && !["text/html", "application/xhtml+xml"].includes(type)) {
      await response.body?.cancel();
      throw new PinterestSourceError(
        "Pinterest returned an unsupported page.",
        "PINTEREST_SOURCE_UNAVAILABLE",
      );
    }
    const content = parsePinterestHtml(
      await readLimitedText(response, MAX_HTML_BYTES),
      url,
    );
    if (requestedId && requestedId !== content.id) {
      throw new PinterestSourceError(
        "Pinterest returned a different pin.",
        "PINTEREST_SOURCE_UNAVAILABLE",
      );
    }
    return content;
  }
  throw new PinterestSourceError(
    "Pinterest pin unavailable.",
    "PINTEREST_SOURCE_UNAVAILABLE",
  );
}
