import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

import { selectBestRecipeImages } from "../../utils/recipe-quality";

const NON_RECIPE_IMAGE_PATTERNS = [
  /\badvertisement\b/,
  /\bavatar\b/,
  /\bbadge\b/,
  /\bcookbook\b/,
  /\bfavicon\b/,
  /\bfacebook\b/,
  /\bheadshot\b/,
  /(?:^|[\s/_.-])icon(?:[\s/_.-]|$)/,
  /\binstagram\b/,
  /\blogo\b/,
  /\bpinterest\b/,
  /\bplaceholder\b/,
  /\bportrait\b/,
  /\bprofile\b/,
  /\bsocial\b/,
  /\bsponsor\b/,
];

/**
 * Clean HTML content for AI processing
 *
 * Removes noise elements (scripts, styles, nav, ads, comments) and extracts
 * the main content text. Limits output to 15,000 characters for AI context.
 */
export function cleanHtml(rawHtml: string): string {
  const $ = cheerio.load(rawHtml);

  $("script, style, nav, footer, header, aside, noscript, iframe").remove();
  $(".ads, .comments, .sidebar, .related-posts, .social-share").remove();
  $('[class*="advertisement"], [class*="promo"], [id*="ad-"]').remove();
  $('[role="navigation"], [role="banner"], [role="contentinfo"]').remove();

  const mainContent = $(
    'article, main, [role="main"], .recipe, .post-content',
  ).first();

  const text = (mainContent.length ? mainContent : $("body")).text();

  return text.replace(/\s+/g, " ").trim().slice(0, 15000);
}

/**
 * Prefer the actual recipe card when a long page contains lots of intro text.
 * Many recipe sites place the full ingredient/instruction list late in the page,
 * so sending only the first 15k characters can miss the usable recipe.
 */
export function focusRecipeContent(text: string, maxChars = 15000): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();
  const instructionIndex = lower.indexOf("instructions");

  if (instructionIndex === -1) {
    return normalized.slice(0, maxChars);
  }

  const ingredientsBeforeInstructions: number[] = [];
  let searchIndex = 0;
  while (searchIndex < instructionIndex) {
    const index = lower.indexOf("ingredients", searchIndex);
    if (index === -1 || index > instructionIndex) break;
    ingredientsBeforeInstructions.push(index);
    searchIndex = index + "ingredients".length;
  }

  const ingredientIndex = ingredientsBeforeInstructions.at(-1);
  if (ingredientIndex == null) {
    return normalized.slice(0, maxChars);
  }

  const leadInChars = Math.min(1800, Math.floor(maxChars * 0.2));
  const contextStart = Math.max(0, ingredientIndex - leadInChars);
  return normalized.slice(contextStart, contextStart + maxChars);
}

/**
 * Extract image URLs from HTML
 *
 * Focuses on content images and filters out common non-content images
 * like logos, icons, social media buttons, etc.
 */
export function extractImageUrls(rawHtml: string, baseUrl: string): string[] {
  const $ = cheerio.load(rawHtml);

  const imageUrls: string[] = [];
  const seen = new Set<string>();
  const addImageUrl = (rawUrl: string | null | undefined) => {
    if (!rawUrl || rawUrl.startsWith("data:")) return;

    const absoluteUrl = makeAbsoluteUrl(rawUrl, baseUrl);
    if (
      !absoluteUrl ||
      seen.has(absoluteUrl) ||
      isLikelyNonRecipeImage(rawUrl)
    ) {
      return;
    }

    seen.add(absoluteUrl);
    imageUrls.push(absoluteUrl);
  };

  // Schema.org Recipe images are the clearest signal when present.
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const jsonText = $(el).html();
      if (!jsonText) return;

      const data = JSON.parse(jsonText);
      const images = extractRecipeImagesFromJsonLd(data);

      for (const imgUrl of images) {
        addImageUrl(imgUrl);
      }
    } catch {
      // Ignore invalid JSON
    }
  });

  // Remove non-content sections after reading JSON-LD from script tags.
  $("script, style, nav, footer, header, aside, noscript, iframe").remove();
  $(".ads, .comments, .sidebar, .social-share").remove();
  $('[class*="advertisement"], [class*="promo"], [id*="ad-"]').remove();

  // Open Graph/Twitter images are often the most reliable hero image,
  // especially when the recipe card lazy-loads images via JavaScript.
  $(
    [
      'meta[property="og:image"]',
      'meta[property="og:image:url"]',
      'meta[name="twitter:image"]',
      'meta[name="twitter:image:src"]',
      'link[rel="image_src"]',
    ].join(","),
  ).each((_, el) => {
    addImageUrl($(el).attr("content") || $(el).attr("href"));
  });

  // Focus on main content area
  const mainContent = $(
    'article, main, [role="main"], .recipe, .post-content',
  ).first();
  const searchContext = mainContent.length ? mainContent : $("body");

  $(
    [
      ".wprm-recipe img",
      ".tasty-recipes img",
      ".mv-create-card img",
      ".recipe-card img",
      ".recipe-press-recipe img",
      ".easyrecipe img",
      '[itemtype*="schema.org/Recipe"] img',
      '[itemtype*="Recipe"] img',
      '[typeof*="Recipe"] img',
    ].join(","),
  ).each((_, el) => {
    if (isInNonRecipeRegion($, el)) return;

    const src = getImageSrc($, el);
    if (src && !isTinyImage($, el) && !isLikelyNonRecipeImage(src, $, el)) {
      addImageUrl(src);
    }
  });

  // Extract from img tags
  searchContext.find("img").each((_, el) => {
    if (isInNonRecipeRegion($, el)) return;

    const src = getImageSrc($, el);
    if (!src || isTinyImage($, el) || isLikelyNonRecipeImage(src, $, el))
      return;

    addImageUrl(src);
  });

  return selectBestRecipeImages(imageUrls);
}

function getImageSrc($: cheerio.CheerioAPI, el: AnyNode): string | null {
  return (
    chooseBestSrcsetUrl($(el).attr("data-srcset")) ||
    chooseBestSrcsetUrl($(el).attr("srcset")) ||
    $(el).attr("data-original") ||
    $(el).attr("data-src") ||
    $(el).attr("data-lazy-src") ||
    $(el).attr("src") ||
    null
  );
}

function isTinyImage($: cheerio.CheerioAPI, el: AnyNode): boolean {
  const width = parseInt($(el).attr("width") || "0", 10);
  const height = parseInt($(el).attr("height") || "0", 10);
  return (width > 0 && width < 100) || (height > 0 && height < 100);
}

function isInNonRecipeRegion($: cheerio.CheerioAPI, el: AnyNode): boolean {
  return (
    $(el).closest(
      [
        ".ads",
        ".comments",
        ".sidebar",
        ".social-share",
        ".related-posts",
        '[class*="advertisement"]',
        '[class*="author"]',
        '[class*="bio"]',
        '[class*="comment"]',
        '[class*="newsletter"]',
        '[class*="popular"]',
        '[class*="promo"]',
        '[class*="related"]',
        '[class*="shop"]',
        '[id*="ad-"]',
        '[id*="author"]',
        '[id*="comment"]',
        '[id*="popular"]',
        '[id*="related"]',
      ].join(","),
    ).length > 0
  );
}

function isLikelyNonRecipeImage(
  url: string,
  $?: cheerio.CheerioAPI,
  el?: AnyNode,
): boolean {
  const elementText =
    $ && el
      ? [
          $(el).attr("alt"),
          $(el).attr("title"),
          $(el).attr("class"),
          $(el).attr("id"),
          $(el).parent().attr("class"),
          $(el).parent().attr("id"),
        ]
          .filter(Boolean)
          .join(" ")
      : "";
  const text = `${url} ${elementText}`.toLowerCase();

  return NON_RECIPE_IMAGE_PATTERNS.some((pattern) => pattern.test(text));
}

function chooseBestSrcsetUrl(srcset: string | null | undefined): string | null {
  if (!srcset) return null;

  const candidates = srcset
    .split(",")
    .map((candidate) => {
      const [url, descriptor] = candidate.trim().split(/\s+/, 2);
      const width = descriptor?.endsWith("w")
        ? Number(descriptor.slice(0, -1))
        : 0;
      return { url, width: Number.isFinite(width) ? width : 0 };
    })
    .filter((candidate): candidate is { url: string; width: number } =>
      Boolean(candidate.url),
    );

  candidates.sort((a, b) => srcsetCandidateRank(a) - srcsetCandidateRank(b));
  return candidates[0]?.url || null;
}

function srcsetCandidateRank(candidate: { width: number }): number {
  const targetWidth = 1200;
  const maxPreferredWidth = 1600;
  const width = candidate.width;

  if (width <= 0) return Number.MAX_SAFE_INTEGER;
  if (width >= targetWidth && width <= maxPreferredWidth) {
    return width - targetWidth;
  }
  if (width > maxPreferredWidth) {
    return 10_000 + (width - maxPreferredWidth);
  }
  return 20_000 - width;
}

function extractRecipeImagesFromJsonLd(data: unknown): string[] {
  const images: string[] = [];

  if (!data) return images;

  if (Array.isArray(data)) {
    for (const item of data) {
      images.push(...extractRecipeImagesFromJsonLd(item));
    }
    return images;
  }

  if (typeof data === "object") {
    const record = data as Record<string, unknown>;

    if (isRecipeJsonLdNode(record)) {
      images.push(...extractImagePropertyUrls(record.image));
    }

    for (const value of Object.values(record)) {
      if (typeof value === "object" && value !== null) {
        images.push(...extractRecipeImagesFromJsonLd(value));
      }
    }
  }

  return images;
}

function isRecipeJsonLdNode(data: Record<string, unknown>): boolean {
  const rawType = data["@type"];
  const types = Array.isArray(rawType) ? rawType : [rawType];
  return types.some(
    (type) => typeof type === "string" && /\bRecipe\b/i.test(type),
  );
}

function extractImagePropertyUrls(image: unknown): string[] {
  if (!image) return [];

  if (typeof image === "string") return [image];

  if (Array.isArray(image)) {
    return image.flatMap((item) => extractImagePropertyUrls(item));
  }

  if (typeof image !== "object") return [];

  const record = image as Record<string, unknown>;
  const url = record.url || record.contentUrl || record["@id"];
  if (typeof url !== "string" || url.startsWith("#")) return [];
  return [url];
}

/**
 * Extract step-associated images from HTML structure
 *
 * Looks for images within or near instruction steps (ol li, .step, .instruction elements)
 * and returns context that can be appended to the AI prompt
 */
export function extractStepImageContext(
  rawHtml: string,
  baseUrl: string,
): string {
  const $ = cheerio.load(rawHtml);

  // Remove non-content sections first
  $("script, style, nav, footer, header, aside, noscript, iframe").remove();
  $(".ads, .comments, .sidebar, .social-share").remove();
  $('[class*="advertisement"], [class*="promo"], [id*="ad-"]').remove();

  const mainContent = $(
    'article, main, [role="main"], .recipe, .post-content',
  ).first();
  const searchContext = mainContent.length ? mainContent : $("body");

  const stepImageHints: string[] = [];

  // Helper to extract image src from various attributes
  const extractImageSrc = ($img: ReturnType<typeof $>): string | null => {
    const src =
      $img.attr("data-src") ||
      $img.attr("data-lazy-src") ||
      $img.attr("data-original") ||
      chooseBestSrcsetUrl($img.attr("data-srcset")) ||
      chooseBestSrcsetUrl($img.attr("srcset")) ||
      $img.attr("src");

    if (!src || src.startsWith("data:")) return null;

    // Filter out non-content images
    if (
      src.includes("logo") ||
      src.includes("icon") ||
      src.includes("avatar") ||
      src.includes("social") ||
      src.includes("badge") ||
      src.includes("placeholder")
    ) {
      return null;
    }

    return makeAbsoluteUrl(src, baseUrl);
  };

  // Look for ordered lists (common for instructions) with nearby images
  searchContext
    .find(
      'ol, .instructions, .method, .steps, [class*="instruction"], [class*="direction"], [class*="step"]',
    )
    .each((_, container) => {
      $(container)
        .find("li, .step, [class*='step']")
        .each((stepIdx, stepEl) => {
          const stepText = $(stepEl).text().trim();
          if (!stepText) return;

          // Find images within this step element
          $(stepEl)
            .find("img")
            .each((_, img) => {
              const src = extractImageSrc($(img));
              if (src) {
                stepImageHints.push(`Step ${stepIdx + 1}: ${src}`);
              }
            });

          // Also check for figure/image immediately after the step
          const nextEl = $(stepEl).next();
          if (
            nextEl.is("figure") ||
            nextEl.is("img") ||
            nextEl.hasClass("image")
          ) {
            nextEl
              .find("img")
              .addBack("img")
              .each((_, img) => {
                const src = extractImageSrc($(img));
                if (src) {
                  stepImageHints.push(`Step ${stepIdx + 1}: ${src}`);
                }
              });
          }
        });
    });

  if (stepImageHints.length === 0) {
    return "";
  }

  return `\n\n[STEP IMAGES - match these URLs to the corresponding instruction step above]:\n${stepImageHints.join("\n")}`;
}

/**
 * Convert relative URL to absolute URL
 */
function makeAbsoluteUrl(url: string, baseUrl: string): string | null {
  try {
    // Already absolute
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return url;
    }

    // Protocol-relative
    if (url.startsWith("//")) {
      const baseProtocol = new URL(baseUrl).protocol;
      return `${baseProtocol}${url}`;
    }

    // Relative URL
    return new URL(url, baseUrl).href;
  } catch {
    return null;
  }
}
