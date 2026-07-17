import { validateFetchUrl } from "./html-fetcher";
import { normalizeRecipeUrl } from "./recipe-quality";

const DEFAULT_MAX_LINKS = 3;
const URL_PATTERN =
  /\b(?:https?:\/\/[^\s<>"'`]+|www\.[a-z0-9.-]+\.[a-z]{2,}\/[^\s<>"'`]*|(?:[a-z0-9-]+\.)+(?:com|net|org|co|io|app|dev|tv|me|uk|ca|au|ie|ly|food|recipes)\/[^\s<>"'`]*)/giu;

const EXCLUDED_HOST_DOMAINS = [
  "instagram.com",
  "cdninstagram.com",
  "threads.net",
  "tiktok.com",
  "tiktokcdn.com",
  "ttwstatic.com",
  "facebook.com",
  "fb.com",
  "fbcdn.net",
  "youtube.com",
  "youtu.be",
  "ytimg.com",
  "googlevideo.com",
  "pinterest.com",
  "pin.it",
  "x.com",
  "twitter.com",
  "reddit.com",
];

const NON_PAGE_PATH_PATTERN =
  /\.(?:avif|gif|jpe?g|m3u8|mov|mp3|mp4|png|svg|webm|webp)(?:$|[?#])/i;

export interface ExtractSocialRecipeLinksOptions {
  maxLinks?: number;
}

function hostnameMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function stripTrailingUrlPunctuation(value: string): string {
  let candidate = value.trim().replace(/^[('"[{]+/, "");

  while (/[),.!?;:'"\]}]$/.test(candidate)) {
    candidate = candidate.slice(0, -1);
  }

  return candidate;
}

function ensureUrlProtocol(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function isExcludedHostname(hostname: string, sourceHostname: string): boolean {
  const normalized = hostname.toLowerCase();
  const normalizedSource = sourceHostname.toLowerCase();

  return (
    hostnameMatches(normalized, normalizedSource) ||
    EXCLUDED_HOST_DOMAINS.some((domain) => hostnameMatches(normalized, domain))
  );
}

function normalizeCandidate(
  rawValue: string,
  sourceUrl: string,
): string | null {
  const trimmed = stripTrailingUrlPunctuation(rawValue);
  if (!trimmed) return null;

  let source: URL;
  let candidate: URL;
  try {
    source = validateFetchUrl(sourceUrl);
    candidate = validateFetchUrl(ensureUrlProtocol(trimmed));
  } catch {
    return null;
  }

  if (isExcludedHostname(candidate.hostname, source.hostname)) return null;
  if (NON_PAGE_PATH_PATTERN.test(candidate.pathname)) return null;

  try {
    return normalizeRecipeUrl(candidate.toString());
  } catch {
    return null;
  }
}

export function extractSocialRecipeLinks(
  values: (string | null | undefined)[],
  sourceUrl: string,
  options: ExtractSocialRecipeLinksOptions = {},
): string[] {
  const maxLinks = options.maxLinks ?? DEFAULT_MAX_LINKS;
  const links: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (!value) continue;

    for (const match of value.matchAll(URL_PATTERN)) {
      const normalized = normalizeCandidate(match[0], sourceUrl);
      if (!normalized || seen.has(normalized)) continue;

      seen.add(normalized);
      links.push(normalized);
      if (links.length >= maxLinks) return links;
    }
  }

  return links;
}
