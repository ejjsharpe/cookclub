import type {
  ParsedRecipe,
  IngredientSection,
  InstructionSection,
} from "../schema";

export type RecipeQualitySource =
  | "cached"
  | "structured"
  | "visible"
  | "reader"
  | "ai"
  | "social_ai";

export interface RecipeQuality {
  score: number;
  confidence: "high" | "medium" | "low";
  usable: boolean;
  ingredientCount: number;
  instructionCount: number;
  reasons: string[];
}

export const MAX_RECIPE_IMAGES = 6;
const MOBILE_RECIPE_IMAGE_TARGET_WIDTH = 1200;
const MOBILE_RECIPE_IMAGE_MAX_WIDTH = 1600;

const BAD_DESCRIPTION_PATTERNS = [
  /\bread more\b/i,
  /\bfollow\b/i,
  /\bsign in\b/i,
  /\bsign up\b/i,
  /\bcreate an account\b/i,
  /\badvertisement\b/i,
  /\bsponsored\b/i,
  /\bnutritional info\b/i,
  /\bimage credit\b/i,
  /\bphoto credit\b/i,
  /^\s*published\s+/i,
  /^\s*updated\s+/i,
];

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
  "gbraid",
  "wbraid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "ref",
]);

const GENERIC_SOCIAL_INSTRUCTION_PATTERN =
  /follow the method shown in the source video using the listed ingredients/i;
const EMOJI_NUMBER_MARKER_PATTERN =
  /^(?:[0-9#*]\uFE0F?\u20E3|[\u2460-\u2473\u24EA\u24F5-\u24FF\u2776-\u277F\u2780-\u2793])\s*[.)\]:：-]?\s*/u;
const LEADING_INSTRUCTION_MARKER_PATTERN =
  /^(?:[-*•·▪▫◦\s]+|(?:step\s*)?\d{1,3}\s*[.)\]:：-]\s*)+/iu;
const GENERIC_TITLE_KEYS = new Set([
  "explore",
  "food",
  "follow",
  "following",
  "imported recipe",
  "imported social recipe",
  "instagram",
  "log in",
  "open app",
  "post",
  "recipe",
  "reel",
  "reels",
  "sign in",
  "sign up",
  "untitled",
  "watch",
]);
const SOCIAL_SOURCE_DOMAINS = [
  "instagram.com",
  "tiktok.com",
  "facebook.com",
  "fb.com",
  "youtube.com",
  "youtu.be",
  "pinterest.com",
  "threads.net",
  "x.com",
  "twitter.com",
];

function countIngredients(sections: IngredientSection[]): number {
  return sections.reduce((sum, section) => sum + section.ingredients.length, 0);
}

function countInstructions(sections: InstructionSection[]): number {
  return sections.reduce(
    (sum, section) => sum + section.instructions.length,
    0,
  );
}

function isBadDescription(description: string | null | undefined): boolean {
  if (!description) return false;
  const normalized = description.trim();
  if (normalized.length > 700) return true;
  return BAD_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

function normalizedTitleKey(title: string): string {
  return title
    .replace(/[\u200D\uFE0F]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isGenericTitle(title: string): boolean {
  const key = normalizedTitleKey(title);
  return (
    !key ||
    GENERIC_TITLE_KEYS.has(key) ||
    /^follow(?:\s+on\s+\w+)?$/.test(key) ||
    /^(?:watch|view)\s+(?:on\s+)?(?:instagram|tiktok|facebook|youtube)$/.test(
      key,
    )
  );
}

function isSocialSourceUrl(url: string | null | undefined): boolean {
  if (!url) return false;

  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return SOCIAL_SOURCE_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    );
  } catch {
    return false;
  }
}

function isInstagramSourceUrl(url: string | null | undefined): boolean {
  if (!url) return false;

  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "instagram.com" || hostname.endsWith(".instagram.com");
  } catch {
    return false;
  }
}

function fallbackTitleForRecipe(recipe: ParsedRecipe): string {
  return isSocialSourceUrl(recipe.sourceUrl)
    ? "Imported Social Recipe"
    : "Imported Recipe";
}

function cleanRecipeTitle(recipe: ParsedRecipe): string {
  const title = recipe.name.replace(/\s+/g, " ").trim();
  return isGenericTitle(title) ? fallbackTitleForRecipe(recipe) : title;
}

function cleanInstructionText(value: string): string {
  let text = value.replace(/\s+/g, " ").trim();

  for (let index = 0; index < 3; index++) {
    const next = text
      .replace(EMOJI_NUMBER_MARKER_PATTERN, "")
      .replace(LEADING_INSTRUCTION_MARKER_PATTERN, "")
      .trim();

    if (next === text) break;
    text = next;
  }

  return text;
}

function isBadImageUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    !/^https?:\/\//i.test(url) ||
    lower.startsWith("blob:") ||
    lower.startsWith("data:") ||
    lower.includes("/api/v1/") ||
    lower.includes("ad.gt") ||
    lower.includes("adnxs") ||
    lower.includes("pubmatic") ||
    lower.includes("rubiconproject") ||
    lower.includes("adsrvr") ||
    lower.includes("avatar") ||
    lower.includes("logo") ||
    lower.includes("placeholder")
  );
}

interface ImageVariantInfo {
  url: string;
  key: string;
  width: number | null;
  height: number | null;
  isOriginal: boolean;
}

function readDimension(value: string | null): number | null {
  if (!value) return null;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function imageVariantInfo(url: string): ImageVariantInfo {
  try {
    const parsed = new URL(url);
    let pathname = parsed.pathname;
    let width: number | null = null;
    let height: number | null = null;
    let isGeneratedVariant = false;

    pathname = pathname.replace(
      /-(\d{2,5})x(\d{2,5})(?=\.(?:avif|jpe?g|png|webp)$)/i,
      (_match, rawWidth: string, rawHeight: string) => {
        width = readDimension(rawWidth);
        height = readDimension(rawHeight);
        isGeneratedVariant = true;
        return "";
      },
    );

    const resize = parsed.searchParams.get("resize");
    const resizeMatch = resize?.match(/^(\d{2,5})[x,](\d{2,5})$/);
    if (resizeMatch) {
      width = readDimension(resizeMatch[1] ?? null);
      height = readDimension(resizeMatch[2] ?? null);
      isGeneratedVariant = true;
    }

    const queryWidth =
      readDimension(parsed.searchParams.get("w")) ??
      readDimension(parsed.searchParams.get("width"));
    const queryHeight =
      readDimension(parsed.searchParams.get("h")) ??
      readDimension(parsed.searchParams.get("height"));
    if (queryWidth || queryHeight) {
      width = queryWidth ?? width;
      height = queryHeight ?? height;
      isGeneratedVariant = true;
    }

    if (isGeneratedVariant) {
      for (const param of [
        "crop",
        "fit",
        "h",
        "height",
        "q",
        "quality",
        "resize",
        "w",
        "width",
      ]) {
        parsed.searchParams.delete(param);
      }
    }

    parsed.pathname = pathname;
    parsed.hash = "";
    parsed.searchParams.sort();

    return {
      url,
      key: parsed.toString(),
      width,
      height,
      isOriginal: !isGeneratedVariant,
    };
  } catch {
    return {
      url,
      key: url,
      width: null,
      height: null,
      isOriginal: true,
    };
  }
}

function imageVariantScore(info: ImageVariantInfo): number {
  if (info.isOriginal && info.width == null) return 1_000_000;
  if (info.width == null) return 0;

  const width = info.width;
  const height = info.height ?? info.width;
  const tooSmallPenalty = width < 700 || height < 500 ? -100_000 : 0;

  if (width >= MOBILE_RECIPE_IMAGE_TARGET_WIDTH) {
    const oversizePenalty =
      width > MOBILE_RECIPE_IMAGE_MAX_WIDTH
        ? width - MOBILE_RECIPE_IMAGE_MAX_WIDTH
        : 0;
    return (
      100_000 -
      Math.abs(width - MOBILE_RECIPE_IMAGE_TARGET_WIDTH) -
      oversizePenalty +
      tooSmallPenalty
    );
  }

  return width + tooSmallPenalty;
}

export function selectBestRecipeImages(
  imageUrls: string[],
  maxImages = MAX_RECIPE_IMAGES,
): string[] {
  const groups = new Map<
    string,
    { index: number; variants: { url: string; score: number }[] }
  >();

  for (const rawUrl of imageUrls) {
    const url = rawUrl.trim();
    if (!url || isBadImageUrl(url)) continue;

    const info = imageVariantInfo(url);
    const existing = groups.get(info.key);
    const variant = { url, score: imageVariantScore(info) };

    if (existing) {
      if (!existing.variants.some((item) => item.url === url)) {
        existing.variants.push(variant);
      }
      continue;
    }

    groups.set(info.key, { index: groups.size, variants: [variant] });
  }

  return Array.from(groups.values())
    .sort((a, b) => a.index - b.index)
    .map((group) => group.variants.sort((a, b) => b.score - a.score)[0]?.url)
    .filter((url): url is string => Boolean(url))
    .slice(0, maxImages);
}

function sourceBonus(source: RecipeQualitySource): number {
  switch (source) {
    case "structured":
      return 16;
    case "visible":
      return 12;
    case "reader":
      return 10;
    case "cached":
      return 8;
    case "social_ai":
      return 8;
    case "ai":
      return 5;
  }
}

function sourceThreshold(source: RecipeQualitySource): number {
  switch (source) {
    case "structured":
      return 45;
    case "visible":
      return 50;
    case "reader":
      return 50;
    case "cached":
      return 45;
    case "social_ai":
      return 52;
    case "ai":
      return 60;
  }
}

export function normalizeRecipeForImport(recipe: ParsedRecipe): ParsedRecipe {
  const ingredientSections = recipe.ingredientSections
    .map((section) => ({
      name: section.name?.trim() || null,
      ingredients: section.ingredients
        .filter((ingredient) => ingredient.name.trim().length > 0)
        .map((ingredient, index) => ({
          ...ingredient,
          index,
          name: ingredient.name.trim(),
          unit: ingredient.unit?.trim() || null,
        })),
    }))
    .filter((section) => section.ingredients.length > 0);

  const instructionSections = recipe.instructionSections
    .map((section) => ({
      name: section.name?.trim() || null,
      instructions: section.instructions
        .map((instruction) => ({
          ...instruction,
          instruction: cleanInstructionText(instruction.instruction),
        }))
        .filter((instruction) => instruction.instruction.length > 0)
        .map((instruction, index) => ({
          ...instruction,
          index,
          imageUrl: instruction.imageUrl?.trim() || null,
        })),
    }))
    .filter((section) => section.instructions.length > 0);

  const images = selectBestRecipeImages(recipe.images ?? []);

  return {
    ...recipe,
    name: cleanRecipeTitle(recipe),
    description:
      recipe.description && !isBadDescription(recipe.description)
        ? recipe.description.trim()
        : null,
    ingredientSections,
    instructionSections,
    images,
  };
}

export function mergeRecipeImages(
  recipe: ParsedRecipe,
  images: string[],
): ParsedRecipe {
  const merged = Array.from(new Set([...(recipe.images ?? []), ...images]));
  return normalizeRecipeForImport({ ...recipe, images: merged });
}

export function normalizeRecipeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";

  for (const key of Array.from(parsed.searchParams.keys())) {
    if (
      TRACKING_PARAMS.has(key.toLowerCase()) ||
      key.toLowerCase().startsWith("utm_")
    ) {
      parsed.searchParams.delete(key);
    }
  }

  parsed.searchParams.sort();
  return parsed.toString();
}

export function evaluateRecipeQuality(
  inputRecipe: ParsedRecipe,
  source: RecipeQualitySource,
): RecipeQuality {
  const recipe = normalizeRecipeForImport(inputRecipe);
  const ingredientCount = countIngredients(recipe.ingredientSections);
  const instructionCount = countInstructions(recipe.instructionSections);
  const reasons: string[] = [];
  let score = sourceBonus(source);

  if (recipe.name.length >= 3) {
    score += 24;
  } else {
    reasons.push("missing_title");
    score -= 25;
  }

  if (isGenericTitle(recipe.name)) {
    reasons.push("generic_title");
    score -= 20;
  }

  score += Math.min(ingredientCount * 5, 30);
  score += Math.min(instructionCount * 7, 30);

  if ((recipe.images ?? []).length > 0) score += 8;
  if (recipe.prepTime || recipe.cookTime || recipe.totalTime) score += 5;
  if (recipe.servings) score += 4;
  if (recipe.description) score += 4;
  if (isBadDescription(inputRecipe.description)) {
    reasons.push("bad_description");
    score -= 12;
  }

  const allInstructions = recipe.instructionSections.flatMap(
    (section) => section.instructions,
  );
  const hasOnlyGenericSocialInstruction =
    source === "social_ai" &&
    allInstructions.length === 1 &&
    GENERIC_SOCIAL_INSTRUCTION_PATTERN.test(
      allInstructions[0]?.instruction ?? "",
    );
  if (hasOnlyGenericSocialInstruction) {
    reasons.push("generic_social_instruction");
    score -=
      ingredientCount >= 5 && isInstagramSourceUrl(recipe.sourceUrl) ? 18 : 35;
  }

  if (ingredientCount === 0) reasons.push("missing_ingredients");
  if (instructionCount === 0) reasons.push("missing_instructions");

  const hasMinimumShape =
    recipe.name.length >= 3 && ingredientCount >= 1 && instructionCount >= 1;
  const threshold = sourceThreshold(source);
  const usable = hasMinimumShape && score >= threshold;
  const confidence =
    score >= 75 ? "high" : score >= threshold ? "medium" : "low";

  return {
    score,
    confidence,
    usable,
    ingredientCount,
    instructionCount,
    reasons,
  };
}
