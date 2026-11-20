import {
  RECIPE_IMPORT_LIMITS,
  isBasicImportUnsupportedUrl,
  type RecipeImportType,
} from "@repo/contracts/recipe-import";

import {
  getRecipeImportSocialPlatform,
  type RecipeImportSocialPlatform,
} from "../utils/socialPlatforms";

/** The shortest pasted recipe text worth sending to smart import. */
export const MIN_RECIPE_TEXT_LENGTH = 50;

/** A web link anywhere in a block of text. */
export const URL_PATTERN = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;

/**
 * How much other text can sit around a link (a caption, "look at this")
 * before we treat the whole thing as a typed-out recipe instead.
 */
const MAX_TEXT_AROUND_LINK = 120;

/** What someone has typed or pasted into the import box. */
export type DetectedImportSource =
  | { kind: "empty" }
  | {
      kind: "url";
      url: string;
      /** e.g. "bbcgoodfood.com" */
      site: string;
      social: RecipeImportSocialPlatform | null;
      /** Quick import only reads recipe websites, not social posts */
      canQuickImport: boolean;
    }
  | { kind: "text"; text: string };

// A bare domain with a path, like "bbcgoodfood.com/recipes/curry"
const BARE_DOMAIN_WITH_PATH = /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+\/\S*$/i;

// Needs a real-looking ending like ".com" or ".co.uk", so "1.5" and "e.g"
// aren't mistaken for links
const looksLikeWebHost = (hostname: string) => {
  const labels = hostname.split(".");
  const ending = labels[labels.length - 1] ?? "";
  return labels.length >= 2 && /^[a-z]{2,}$/i.test(ending);
};

const parseUrl = (value: string): URL | null => {
  if (/\s/.test(value)) return null;
  const candidate = /^https?:\/\//i.test(value)
    ? value
    : BARE_DOMAIN_WITH_PATH.test(value) || /^www\./i.test(value)
      ? `https://${value}`
      : null;
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    const isWeb = url.protocol === "http:" || url.protocol === "https:";
    return isWeb && looksLikeWebHost(url.hostname) ? url : null;
  } catch {
    return null;
  }
};

/** The one link in a short caption, e.g. "Butter chicken https://…" */
const linkInCaption = (value: string): URL | null => {
  const links = value.match(URL_PATTERN) ?? [];
  if (links.length !== 1) return null;
  const rest = value.replace(links[0]!, "").trim();
  if (rest.length > MAX_TEXT_AROUND_LINK) return null;
  return parseUrl(links[0]!);
};

/**
 * Works out whether the import box holds a link or recipe text, so the app
 * can pick quick or smart import without asking.
 */
export function detectImportSource(input: string): DetectedImportSource {
  const value = input.trim();
  if (!value) return { kind: "empty" };

  const url = parseUrl(value) ?? linkInCaption(value);
  if (url) {
    const href = url.toString();
    return {
      kind: "url",
      url: href,
      site: url.hostname.replace(/^www\./, ""),
      social: getRecipeImportSocialPlatform(href),
      canQuickImport: !isBasicImportUnsupportedUrl(href),
    };
  }

  return { kind: "text", text: value };
}

/**
 * Quick import for recipe websites, because it's free and instant; smart
 * import for everything quick import can't read.
 */
export function defaultImportType(
  source: DetectedImportSource,
  imageCount = 0,
): RecipeImportType {
  if (imageCount > 0) return "smart";
  return source.kind === "url" && source.canQuickImport ? "basic" : "smart";
}

/** Why this can't be imported yet, or null when it's ready to go. */
export function importSourceProblem(
  source: DetectedImportSource,
  imageCount = 0,
): string | null {
  if (imageCount > 0) return null;
  switch (source.kind) {
    case "empty":
      return "Paste a link or a recipe first";
    case "url":
      return source.url.length > RECIPE_IMPORT_LIMITS.urlCharacters
        ? "That link is too long"
        : null;
    case "text":
      if (source.text.length < MIN_RECIPE_TEXT_LENGTH) {
        return "Paste a bit more of the recipe, or a link to it";
      }
      return source.text.length > RECIPE_IMPORT_LIMITS.textCharacters
        ? "That's too much text. Paste just the recipe"
        : null;
  }
}
