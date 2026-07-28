import type { NutritionInput, NutritionResponse } from "@repo/contracts";

import { fetchHtml } from "../import/url/fetch";
import { extractStructuredRecipeCandidates } from "../import/url/structured-data";
import type { Nutrition } from "../schema";
import {
  DEFAULT_MAX_TOKENS,
  parseAiJsonResponse,
  type AiClient,
} from "../utils/ai-response-parser";
import { normalizeNutrition } from "../utils/nutrition-normalizer";

function hasNutritionValues(nutrition: Nutrition | null | undefined) {
  if (!nutrition) return false;
  return [
    nutrition.calories,
    nutrition.protein,
    nutrition.carbohydrates,
    nutrition.fat,
    nutrition.saturatedFat,
    nutrition.fiber,
    nutrition.sugar,
    nutrition.sodium,
    nutrition.cholesterol,
    nutrition.potassium,
    nutrition.vitaminA,
    nutrition.vitaminC,
    nutrition.calcium,
    nutrition.iron,
  ].some((value) => typeof value === "number" && Number.isFinite(value));
}

function hasCoreNutritionValues(nutrition: Nutrition | null | undefined) {
  if (!nutrition) return false;
  return [
    nutrition.calories,
    nutrition.protein,
    nutrition.carbohydrates,
    nutrition.fat,
  ].every((value) => typeof value === "number" && Number.isFinite(value));
}

function confidenceRank(
  confidence: Nutrition["confidence"] | null | undefined,
) {
  switch (confidence) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

function lowestConfidence(
  left: Nutrition["confidence"] | null | undefined,
  right: Nutrition["confidence"] | null | undefined,
): Nutrition["confidence"] {
  if (!left) return right ?? null;
  if (!right) return left;
  return confidenceRank(left) <= confidenceRank(right) ? left : right;
}

function mergeNutrition(
  base: Nutrition | null | undefined,
  estimate: Nutrition,
): Nutrition {
  if (!base) return estimate;

  return {
    calories: base.calories ?? estimate.calories,
    protein: base.protein ?? estimate.protein,
    carbohydrates: base.carbohydrates ?? estimate.carbohydrates,
    fat: base.fat ?? estimate.fat,
    saturatedFat: base.saturatedFat ?? estimate.saturatedFat,
    fiber: base.fiber ?? estimate.fiber,
    sugar: base.sugar ?? estimate.sugar,
    sodium: base.sodium ?? estimate.sodium,
    cholesterol: base.cholesterol ?? estimate.cholesterol,
    potassium: base.potassium ?? estimate.potassium,
    vitaminA: base.vitaminA ?? estimate.vitaminA,
    vitaminC: base.vitaminC ?? estimate.vitaminC,
    calcium: base.calcium ?? estimate.calcium,
    iron: base.iron ?? estimate.iron,
    source: "ai_estimated",
    confidence: lowestConfidence(base.confidence, estimate.confidence),
  };
}

async function extractNutritionFromSource(
  sourceUrl: string | null | undefined,
): Promise<Nutrition | null> {
  if (!sourceUrl) return null;

  try {
    const html = await fetchHtml(sourceUrl, 0);
    const structuredRecipe = extractStructuredRecipeCandidates(
      html,
      sourceUrl,
    ).find((recipe) => hasNutritionValues(recipe.nutrition));

    return structuredRecipe?.nutrition ?? null;
  } catch (error) {
    console.log(
      "Nutrition source extraction failed:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

function recipeToNutritionPrompt(
  recipe: NutritionInput["recipe"],
  existingNutrition?: Nutrition | null,
) {
  const ingredients = recipe.ingredientSections
    .flatMap((section) => section.ingredients)
    .map((ingredient) =>
      [ingredient.quantity, ingredient.unit, ingredient.name]
        .filter(Boolean)
        .join(" "),
    )
    .join("\n");

  const instructions = recipe.instructionSections
    .flatMap((section) => section.instructions)
    .map((instruction) => instruction.instruction)
    .join("\n");

  return `
Estimate nutrition for one serving of this recipe. Return JSON only, with numeric values or null:
{
  "calories": number | null,
  "protein": number | null,
  "carbohydrates": number | null,
  "fat": number | null,
  "saturatedFat": number | null,
  "fiber": number | null,
  "sugar": number | null,
  "sodium": number | null,
  "cholesterol": number | null,
  "potassium": number | null,
  "vitaminA": number | null,
  "vitaminC": number | null,
  "calcium": number | null,
  "iron": number | null,
  "confidence": "low" | "medium" | "high"
}

All values must be per serving, not for the whole recipe. Estimate the whole-recipe total from ingredient amounts, then divide by the number of servings before returning values. For example, a recipe with about 2,000 kcal total and 4 servings should return about 500 calories. If servings are missing, assume 4 servings and set confidence to low.

Use kcal for calories, grams for protein/carbohydrates/fat/saturatedFat/fiber/sugar, milligrams for sodium/cholesterol/potassium, and percent daily value for vitaminA/vitaminC/calcium/iron. Estimate conservatively from the ingredient amounts and serving count. Always estimate calories, protein, carbohydrates, and fat when the recipe has ingredients; use null mainly for extended micronutrients when unknown.

Known per-serving nutrition from the source, if any:
${existingNutrition ? JSON.stringify(existingNutrition) : "none"}

Use known source nutrition as anchors when estimating missing fields. Return a complete per-serving estimate object; existing source values will be preserved by the caller.

Recipe: ${recipe.name}
Description: ${recipe.description ?? ""}
Servings: ${recipe.servings ?? "unknown"}
Ingredients:
${ingredients}

Method:
${instructions}
`;
}

async function runNutritionModel(
  ai: AiClient,
  recipe: NutritionInput["recipe"],
  existingNutrition?: Nutrition | null,
): Promise<Nutrition> {
  const request: Record<string, unknown> = {
    messages: [
      {
        role: "system",
        content:
          "You are a nutrition analysis assistant. Return only valid JSON. Values must be per-serving estimates, never whole-recipe totals.",
      },
      {
        role: "user",
        content: recipeToNutritionPrompt(recipe, existingNutrition),
      },
    ],
    max_tokens: DEFAULT_MAX_TOKENS,
    temperature: 0.1,
  };

  const response = await ai.complete("text", request);
  const nutrition = normalizeNutrition(
    parseAiJsonResponse<Record<string, unknown>>(response),
    "ai_estimated",
  );
  if (!hasNutritionValues(nutrition)) {
    throw new Error("AI returned empty nutrition estimates.");
  }

  return nutrition;
}

async function estimateNutritionWithAi(
  ai: AiClient,
  recipe: NutritionInput["recipe"],
  existingNutrition?: Nutrition | null,
): Promise<Nutrition> {
  return await runNutritionModel(ai, recipe, existingNutrition);
}

export async function generateNutrition(
  input: NutritionInput,
  ai: AiClient,
): Promise<NutritionResponse> {
  const existing = input.recipe.nutrition;
  if (hasNutritionValues(existing)) {
    const source =
      existing?.source === "ai_estimated" ||
      existing?.source === "manual" ||
      existing?.source === "imported"
        ? existing.source
        : "extracted";
    const normalizedExisting = normalizeNutrition(
      existing as Record<string, unknown>,
      source,
    );
    if (hasCoreNutritionValues(normalizedExisting)) {
      return {
        success: true,
        data: normalizedExisting,
      };
    }

    try {
      const estimated = await estimateNutritionWithAi(
        ai,
        input.recipe,
        normalizedExisting,
      );
      return {
        success: true,
        data: mergeNutrition(normalizedExisting, estimated),
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: "NUTRITION_GENERATION_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Could not generate nutrition for this recipe",
        },
      };
    }
  }

  const extracted = await extractNutritionFromSource(
    input.sourceUrl ?? input.recipe.sourceUrl,
  );
  if (hasCoreNutritionValues(extracted)) {
    return { success: true, data: extracted! };
  }

  try {
    const estimated = await estimateNutritionWithAi(
      ai,
      input.recipe,
      extracted,
    );
    return { success: true, data: mergeNutrition(extracted, estimated) };
  } catch (error) {
    return {
      success: false,
      error: {
        code: "NUTRITION_GENERATION_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Could not generate nutrition for this recipe",
      },
    };
  }
}
