import type { ParsedRecipe } from "../schema";
import { ParsedRecipeSchema } from "../schema";
import type { RecipeCandidate } from "./url-parse-utils";
import {
  discoverAlternateRecipeUrls,
  getWordPressRestPostUrl,
} from "../utils/alternate-pages";
import {
  cleanHtml,
  extractImageUrls,
  focusRecipeContent,
} from "../utils/html-cleaner";
import { fetchHtml, readLimitedText } from "../utils/html-fetcher";
import { fetchReaderMarkdown } from "../utils/reader-fetcher";
import { extractRecipeOutline } from "../utils/recipe-outline-parser";
import {
  evaluateRecipeQuality,
  mergeRecipeImages,
  normalizeRecipeForImport,
} from "../utils/recipe-quality";
import { extractStructuredRecipeCandidates } from "../utils/structured-data";
import {
  extractMarkdownRecipeCard,
  extractVisibleRecipeCard,
} from "../utils/visible-recipe-card";

function elapsed(startTime: number): number {
  return Math.max(0, Date.now() - startTime);
}

export async function collectReaderCandidates(
  url: string,
): Promise<RecipeCandidate[]> {
  const startTime = Date.now();
  try {
    const markdown = await fetchReaderMarkdown(url);
    const markdownRecipe = extractMarkdownRecipeCard(markdown, url);
    const outlineRecipe = extractRecipeOutline(markdown, {
      sourceUrl: url,
      sourceType: "url",
      images: markdownRecipe?.images ?? [],
    });

    return [
      {
        recipe: markdownRecipe,
        source: "reader",
        parseMethod: "reader",
        elapsedMs: elapsed(startTime),
        evidence: {
          imageCount: markdownRecipe?.images?.length ?? 0,
          textLength: markdown.length,
          sourceUrl: url,
        },
      },
      {
        recipe: outlineRecipe,
        source: "reader",
        parseMethod: "outline_rules",
        elapsedMs: elapsed(startTime),
        evidence: {
          imageCount: outlineRecipe?.images?.length ?? 0,
          textLength: markdown.length,
          sourceUrl: url,
        },
      },
    ];
  } catch (error) {
    console.log(
      "Reader fallback failed:",
      error instanceof Error ? error.message : error,
    );
    return [
      {
        recipe: null,
        source: "reader",
        parseMethod: "reader",
        elapsedMs: elapsed(startTime),
        evidence: { sourceUrl: url },
        error,
      },
    ];
  }
}

function withOriginalSourceUrl(
  recipe: ParsedRecipe | null,
  sourceUrl: string,
): ParsedRecipe | null {
  return recipe ? { ...recipe, sourceUrl } : null;
}

function structuredRecipeCandidates(
  html: string,
  htmlUrl: string,
  sourceUrl: string,
  imageUrls: string[],
): RecipeCandidate[] {
  return extractStructuredRecipeCandidates(html, htmlUrl).map((recipe) => ({
    recipe: mergeRecipeImages({ ...recipe, sourceUrl }, imageUrls),
    source: "structured",
    parseMethod: "schema_org",
    evidence: {
      imageCount: recipe.images?.length ?? imageUrls.length,
      sourceUrl: htmlUrl,
    },
  }));
}

export function deterministicHtmlCandidates(
  html: string,
  htmlUrl: string,
  sourceUrl: string,
): RecipeCandidate[] {
  const imageUrls = extractImageUrls(html, htmlUrl);
  const visibleRecipe = withOriginalSourceUrl(
    extractVisibleRecipeCard(html, htmlUrl),
    sourceUrl,
  );
  const focusedText = focusRecipeContent(cleanHtml(html), 12_000);
  const outlineRecipe = extractRecipeOutline(focusedText, {
    sourceUrl,
    sourceType: "url",
    images: imageUrls,
  });

  return [
    ...structuredRecipeCandidates(html, htmlUrl, sourceUrl, imageUrls),
    {
      recipe: visibleRecipe
        ? mergeRecipeImages(visibleRecipe, imageUrls)
        : null,
      source: "visible",
      parseMethod: "visible_card",
      evidence: {
        imageCount: imageUrls.length,
        sourceUrl: htmlUrl,
      },
    },
    {
      recipe: outlineRecipe,
      source: "reader",
      parseMethod: "outline_rules",
      evidence: {
        imageCount: imageUrls.length,
        textLength: focusedText.length,
        sourceUrl: htmlUrl,
      },
    },
  ];
}

export async function collectAlternateRecipePageCandidates(
  sourceUrl: string,
  html: string,
): Promise<RecipeCandidate[]> {
  const alternateUrls = discoverAlternateRecipeUrls(html, sourceUrl);
  const candidates: RecipeCandidate[] = [];

  for (const alternateUrl of alternateUrls) {
    const startTime = Date.now();
    try {
      const alternateHtml = await fetchHtml(alternateUrl, 0);
      candidates.push(
        ...deterministicHtmlCandidates(
          alternateHtml,
          alternateUrl,
          sourceUrl,
        ).map((candidate) => ({
          ...candidate,
          id: `alternate-${candidate.parseMethod ?? candidate.source}-${candidates.length + 1}`,
          elapsedMs: elapsed(startTime),
          evidence: {
            ...candidate.evidence,
            sourceUrl: alternateUrl,
          },
        })),
      );
    } catch (error) {
      console.log(
        "Alternate recipe page failed:",
        error instanceof Error ? error.message : error,
      );
      candidates.push({
        recipe: null,
        source: "reader",
        parseMethod: "reader",
        elapsedMs: elapsed(startTime),
        evidence: { sourceUrl: alternateUrl },
        error,
      });
    }
  }

  return candidates;
}

interface WordPressRestPost {
  content?: { rendered?: string };
  excerpt?: { rendered?: string };
  title?: { rendered?: string };
  yoast_head_json?: {
    schema?: unknown;
    og_image?: { url?: string }[];
  };
}

function wordPressPostToHtml(post: WordPressRestPost): string | null {
  const content = post.content?.rendered;
  if (!content) return null;

  const title = post.title?.rendered ?? "";
  const excerpt = post.excerpt?.rendered ?? "";
  const schema = post.yoast_head_json?.schema;
  const ogImage = post.yoast_head_json?.og_image?.[0]?.url;
  const schemaScript = schema
    ? `<script type="application/ld+json">${JSON.stringify(schema)}</script>`
    : "";
  const imageMeta = ogImage
    ? `<meta property="og:image" content="${ogImage}">`
    : "";

  return `
    <html>
      <head>${schemaScript}${imageMeta}</head>
      <body>
        <article>
          <h1>${title}</h1>
          ${excerpt}
          ${content}
        </article>
      </body>
    </html>
  `;
}

async function fetchWordPressRestHtml(restUrl: string): Promise<string | null> {
  const response = await fetch(restUrl, {
    signal: AbortSignal.timeout(8_000),
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) return null;

  const data: unknown =
    !response.body &&
    typeof (response as { json?: () => Promise<unknown> }).json === "function"
      ? await (response as { json: () => Promise<unknown> }).json()
      : JSON.parse(await readLimitedText(response, 512 * 1024));
  const post = Array.isArray(data) ? data[0] : data;
  if (!post || typeof post !== "object") return null;

  return wordPressPostToHtml(post as WordPressRestPost);
}

export async function collectWordPressRestCandidates(
  sourceUrl: string,
  html: string,
): Promise<RecipeCandidate[]> {
  const restUrl = getWordPressRestPostUrl(html, sourceUrl);
  if (!restUrl) return [];

  const startTime = Date.now();
  try {
    const restHtml = await fetchWordPressRestHtml(restUrl);
    if (!restHtml) return [];

    return deterministicHtmlCandidates(restHtml, sourceUrl, sourceUrl).map(
      (candidate) => ({
        ...candidate,
        id: `wordpress-${candidate.parseMethod ?? candidate.source}`,
        elapsedMs: elapsed(startTime),
        evidence: {
          ...candidate.evidence,
          sourceUrl: restUrl,
        },
      }),
    );
  } catch (error) {
    console.log(
      "WordPress REST fallback failed:",
      error instanceof Error ? error.message : error,
    );
    return [
      {
        recipe: null,
        source: "reader",
        parseMethod: "reader",
        elapsedMs: elapsed(startTime),
        evidence: { sourceUrl: restUrl },
        error,
      },
    ];
  }
}

export function bestPartialCandidate(
  candidates: RecipeCandidate[],
): ParsedRecipe | null {
  const partials = candidates
    .map((candidate) => {
      if (!candidate.recipe) return null;
      const normalized = normalizeRecipeForImport(candidate.recipe);
      if (ParsedRecipeSchema(normalized) instanceof Error) return null;

      return {
        recipe: normalized,
        quality: evaluateRecipeQuality(normalized, candidate.source),
      };
    })
    .filter(
      (
        partial,
      ): partial is {
        recipe: ParsedRecipe;
        quality: ReturnType<typeof evaluateRecipeQuality>;
      } => Boolean(partial),
    )
    .sort((a, b) => b.quality.score - a.quality.score);

  return partials[0]?.recipe ?? null;
}
