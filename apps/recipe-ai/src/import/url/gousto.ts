import { type } from "arktype";
import * as cheerio from "cheerio";

import { readLimitedText, validateFetchUrl } from "./fetch";
import type { RecipeCandidate } from "./parse";
import type { Ingredient, Nutrition, ParsedRecipe } from "../../schema";
import { parseIngredientText } from "../../utils/ingredient-parser";

const MediaSchema = type({
  images: type({ image: "string", "width?": "number" }).array(),
});
const ResponseSchema = type({
  status: "'ok'",
  data: {
    entry: {
      url: "string",
      title: "string",
      "description?": "string",
      ingredients: type({ label: "string" }).array().atLeastLength(1),
      cooking_instructions: type({
        instruction: "string",
        order: "number",
        "media?": MediaSchema,
      })
        .array()
        .atLeastLength(1),
      "basics?": type({ title: "string" }).array(),
      "prep_times?": { "for_2?": "number" },
      "cuisine?": { title: "string" },
      "media?": MediaSchema,
      "nutritional_information?": {
        "per_portion?": {
          "energy_kcal?": "number",
          "protein_mg?": "number",
          "carbs_mg?": "number",
          "fat_mg?": "number",
          "fat_saturates_mg?": "number",
          "fibre_mg?": "number",
          "carbs_sugars_mg?": "number",
        },
      },
    },
  },
});

function recipeSlug(url: string): string | null {
  const parsed = validateFetchUrl(url);
  if (!["gousto.co.uk", "www.gousto.co.uk"].includes(parsed.hostname)) {
    return null;
  }
  // Gousto also shares cookbook links with a cuisine/category in place of
  // "recipes". Only accept a single slug, never an arbitrary API path.
  return (
    parsed.pathname.match(/^\/cookbook\/[^/]+\/([a-z0-9-]+)\/?$/i)?.[1] ?? null
  );
}

function imageUrl(media: typeof MediaSchema.infer | undefined): string | null {
  const images = [...(media?.images ?? [])].sort(
    (a, b) => (b.width ?? 0) - (a.width ?? 0),
  );
  return images[0]?.image ?? null;
}

function textFromHtml(html: string): string {
  const $ = cheerio.load(html);
  // The base instructions and ingredient labels are for two people; these
  // coloured spans contain the alternative quantities for three/four people.
  $("script, style, .text-purple, .text-danger").remove();
  $("p, br, li").after(" ");
  return $.root().text().replace(/\s+/g, " ").trim();
}

function ingredientFromLabel(label: string): Omit<Ingredient, "index"> | null {
  const text = textFromHtml(label);
  const multiplier = text.match(/\s+x(\d+)$/i);
  const count = multiplier ? Number(multiplier[1]) : 1;
  if (count === 0) return null;

  const withoutMultiplier = text.replace(/\s+x\d+$/i, "");
  const amount = withoutMultiplier.match(
    /^(.*?)\s+\((\d+(?:\.\d+)?)\s*(g|kg|ml|l)\)$/i,
  );
  if (amount) {
    return {
      name: amount[1]!.trim(),
      quantity: Number(amount[2]) * count,
      unit: amount[3]!.toLowerCase(),
    };
  }

  const parsed = parseIngredientText(withoutMultiplier);
  return { ...parsed, quantity: (parsed.quantity ?? 1) * count };
}

function toRecipe(
  entry: typeof ResponseSchema.infer.data.entry,
  sourceUrl: string,
): ParsedRecipe {
  const ingredients = entry.ingredients.flatMap(({ label }) => {
    const ingredient = ingredientFromLabel(label);
    return ingredient ? [ingredient] : [];
  });
  const cover = imageUrl(entry.media);
  const perPortion = entry.nutritional_information?.per_portion;
  const grams = (milligrams: number | undefined) =>
    milligrams == null ? null : milligrams / 1000;
  const nutrition: Nutrition | null = perPortion
    ? {
        calories: perPortion.energy_kcal,
        protein: grams(perPortion.protein_mg),
        carbohydrates: grams(perPortion.carbs_mg),
        fat: grams(perPortion.fat_mg),
        saturatedFat: grams(perPortion.fat_saturates_mg),
        fiber: grams(perPortion.fibre_mg),
        sugar: grams(perPortion.carbs_sugars_mg),
        source: "extracted",
        confidence: "high",
      }
    : null;

  return {
    name: textFromHtml(entry.title),
    description: entry.description ? textFromHtml(entry.description) : null,
    sourceUrl,
    sourceType: "url",
    servings: 2,
    // Gousto calls the complete cooking duration "prep_times".
    totalTime: entry.prep_times?.for_2 ?? null,
    ingredientSections: [
      {
        name: null,
        ingredients: ingredients.map((item, index) => ({ ...item, index })),
      },
      ...(entry.basics?.length
        ? [
            {
              name: "Pantry items",
              ingredients: entry.basics.map(({ title }, index) => ({
                index,
                ...parseIngredientText(textFromHtml(title)),
              })),
            },
          ]
        : []),
    ],
    instructionSections: [
      {
        name: null,
        instructions: [...entry.cooking_instructions]
          .sort((a, b) => a.order - b.order)
          .map((step, index) => ({
            index,
            instruction: textFromHtml(step.instruction),
            imageUrl: imageUrl(step.media),
          })),
      },
    ],
    images: cover ? [cover] : [],
    suggestedTags: entry.cuisine ? [entry.cuisine.title] : [],
    nutrition,
  };
}

/** Read the public data used by Gousto's JavaScript-only cookbook pages. */
export async function collectGoustoRecipeCandidates(
  sourceUrl: string,
): Promise<RecipeCandidate[]> {
  const slug = recipeSlug(sourceUrl);
  if (!slug) return [];

  const apiUrl = `https://production-api.gousto.co.uk/cmsreadbroker/v1/recipe/${slug}`;
  const startedAt = Date.now();
  const candidate: RecipeCandidate = {
    id: "gousto_api",
    recipe: null,
    source: "structured",
    parseMethod: "structured_data",
    evidence: { sourceUrl: apiUrl },
  };

  try {
    const response = await fetch(apiUrl, {
      signal: AbortSignal.timeout(8_000),
      redirect: "error",
      headers: {
        Accept: "application/json",
        "x-gousto-request-source": "content-webclient",
      },
    });
    if (!response.ok) {
      throw new Error(`Gousto recipe request failed: ${response.status}`);
    }

    const data = ResponseSchema(
      JSON.parse(await readLimitedText(response, 512 * 1024)),
    );
    if (data instanceof type.errors) {
      throw new Error("Invalid Gousto recipe data");
    }
    if (data.data.entry.url.replace(/^\/|\/$/g, "") !== slug) {
      throw new Error("Gousto returned a different recipe");
    }

    candidate.recipe = toRecipe(data.data.entry, sourceUrl);
    candidate.evidence!.imageCount = candidate.recipe.images?.length ?? 0;
  } catch (error) {
    // Keep the normal HTML/reader fallbacks available if Gousto changes its API.
    candidate.error = error;
  }

  return [{ ...candidate, elapsedMs: Math.max(0, Date.now() - startedAt) }];
}
