import { getSocialPlatform, type SocialPlatform } from "../import/social";
import { resolveFinalFetchUrl, validateFetchUrl } from "../import/url/fetch";
import type { ParseMetadata } from "../types";
import { normalizeRecipeUrl } from "../utils/recipe-quality";

const SHORT_LINK_HOSTS = new Set([
  // Pinterest and Reddit handle their own share links with platform-only redirects.
  "vm.tiktok.com",
  "vt.tiktok.com",
  "m.tiktok.com",
  "t.co",
  "bit.ly",
  "tinyurl.com",
  "youtu.be",
]);

export interface SourceSnapshot {
  originalUrl: string;
  canonicalUrl: string;
  platform: SocialPlatform | null;
  diagnostics: NonNullable<ParseMetadata["diagnostics"]>;
}

function isShortLink(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return SHORT_LINK_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

export async function createSourceSnapshot(
  url: string,
): Promise<SourceSnapshot> {
  const originalUrl = normalizeRecipeUrl(url);
  validateFetchUrl(originalUrl);

  let finalUrl = originalUrl;
  if (isShortLink(originalUrl)) {
    try {
      finalUrl = await resolveFinalFetchUrl(originalUrl);
    } catch (error) {
      console.log(
        "Short-link resolution failed; using original URL:",
        error instanceof Error ? error.message : error,
      );
    }
  }
  const canonicalUrl = normalizeRecipeUrl(finalUrl);
  const platform = getSocialPlatform(canonicalUrl);

  return {
    originalUrl,
    canonicalUrl,
    platform,
    diagnostics: {
      originalUrl,
      canonicalUrl,
      ...(platform ? { platform } : {}),
    },
  };
}
