import type { Nutrition } from "../schema";

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const match = value.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function pickValue(input: Record<string, unknown>, keys: string[]) {
  return keys.map((key) => input[key]).find((value) => value !== undefined);
}

export function normalizeNutrition(
  input: Record<string, unknown>,
  source: Nutrition["source"],
): Nutrition {
  return {
    calories: numberOrNull(pickValue(input, ["calories", "kcal"])),
    protein: numberOrNull(pickValue(input, ["protein", "protein_g"])),
    carbohydrates: numberOrNull(
      pickValue(input, ["carbohydrates", "carbs", "carbohydrate", "carbs_g"]),
    ),
    fat: numberOrNull(pickValue(input, ["fat", "totalFat", "total_fat"])),
    saturatedFat: numberOrNull(
      pickValue(input, ["saturatedFat", "saturated_fat", "saturatedFat_g"]),
    ),
    fiber: numberOrNull(pickValue(input, ["fiber", "fibre", "fiber_g"])),
    sugar: numberOrNull(pickValue(input, ["sugar", "sugars", "sugar_g"])),
    sodium: numberOrNull(pickValue(input, ["sodium", "sodium_mg"])),
    cholesterol: numberOrNull(
      pickValue(input, ["cholesterol", "cholesterol_mg"]),
    ),
    potassium: numberOrNull(pickValue(input, ["potassium", "potassium_mg"])),
    vitaminA: numberOrNull(pickValue(input, ["vitaminA", "vitamin_a"])),
    vitaminC: numberOrNull(pickValue(input, ["vitaminC", "vitamin_c"])),
    calcium: numberOrNull(pickValue(input, ["calcium", "calcium_dv"])),
    iron: numberOrNull(pickValue(input, ["iron", "iron_dv"])),
    source,
    confidence:
      input.confidence === "high" ||
      input.confidence === "medium" ||
      input.confidence === "low"
        ? input.confidence
        : source === "extracted"
          ? "high"
          : "medium",
  };
}
