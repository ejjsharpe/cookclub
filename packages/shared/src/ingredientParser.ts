import { isRecognizedUnit } from "./unitNormalizer";

export interface ParsedIngredient {
  quantity: number | null;
  unit: string | null;
  name: string;
  preparation: string | null;
  confidence: "high" | "medium" | "low";
  originalText: string;
}

export const PREPARATION_WORDS = [
  "chopped",
  "diced",
  "sliced",
  "minced",
  "crushed",
  "grated",
  "shredded",
  "julienned",
  "cubed",
  "melted",
  "softened",
  "beaten",
  "whisked",
  "room temperature",
  "chilled",
  "frozen",
  "thawed",
  "peeled",
  "seeded",
  "deveined",
  "trimmed",
  "quartered",
  "halved",
  "thinly sliced",
  "finely chopped",
  "roughly chopped",
  "finely diced",
  "coarsely chopped",
];

export function extractPreparation(text: string): {
  name: string;
  preparation: string | null;
} {
  const lower = text.toLowerCase();
  const sortedPreps = [...PREPARATION_WORDS].sort(
    (a, b) => b.length - a.length,
  );

  for (const prep of sortedPreps) {
    if (lower.includes(prep)) {
      const cleanedName = text
        .replace(new RegExp(`\\s*,?\\s*${prep}\\s*,?`, "gi"), " ")
        .replace(/\s+/g, " ")
        .trim();
      return { name: cleanedName, preparation: prep };
    }
  }

  return { name: text, preparation: null };
}

// A leading quantity (whole, decimal, fraction or mixed number such as
// "1 1/2"), then the rest of the line. The unit may be attached ("500g").
// The number must be followed by a space or a letter, so ranges ("1-2"),
// unicode fractions ("2½") and decimal commas ("1,5") aren't split apart.
const QUANTITY_PATTERN =
  /^(\d+\s+\d+\/\d+|\d+\/\d+|\d*\.?\d+)(?:\s+|(?=[a-zA-Z]))(.+)$/;

function parseQuantity(value: string): number | null {
  const mixed = value.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const denominator = Number(mixed[3]);
    return denominator
      ? Number(mixed[1]) + Number(mixed[2]) / denominator
      : null;
  }

  const fraction = value.match(/^(\d+)\/(\d+)$/);
  if (fraction) {
    const denominator = Number(fraction[2]);
    return denominator ? Number(fraction[1]) / denominator : null;
  }

  const numeric = parseFloat(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Takes the first word as the unit only when it is a known measure, so
 * "4 burger buns" stays a name and "4 slices cheese" keeps its unit.
 */
function splitUnit(text: string): { unit: string | null; rest: string } {
  const match = text.match(/^([a-zA-Z]+)\.?\s+(.+)$/);
  if (match && isRecognizedUnit(match[1] ?? null)) {
    return { unit: match[1] ?? null, rest: match[2]?.trim() ?? "" };
  }
  return { unit: null, rest: text };
}

export function parseIngredient(ingredientText: string): ParsedIngredient {
  if (!ingredientText || typeof ingredientText !== "string") {
    return {
      quantity: null,
      unit: null,
      name: ingredientText || "",
      preparation: null,
      confidence: "low",
      originalText: ingredientText || "",
    };
  }

  const trimmed = ingredientText.trim();
  const match = trimmed.match(QUANTITY_PATTERN);

  // A line that is only an amount ("500g", "2 cups") has no ingredient name
  // to split out, so it stays whole.
  if (match && !isRecognizedUnit(match[2]?.trim().replace(/\.$/, "") ?? null)) {
    const quantity = parseQuantity(match[1] ?? "");
    const { unit, rest } = splitUnit(match[2]?.trim() ?? "");
    const { name, preparation } = extractPreparation(rest);

    let confidence: ParsedIngredient["confidence"];
    if (quantity && unit && name) {
      confidence = "high";
    } else if (quantity && name) {
      confidence = "medium";
    } else {
      confidence = "low";
    }

    return {
      quantity,
      unit,
      name,
      preparation,
      confidence,
      originalText: trimmed,
    };
  }

  const { name, preparation } = extractPreparation(trimmed);

  return {
    quantity: null,
    unit: null,
    name,
    preparation,
    confidence: "low",
    originalText: trimmed,
  };
}

export function normalizeIngredientName(name: string): string {
  if (!name) return "";

  let normalized = name.toLowerCase().trim();
  const adjectivesToRemove = [
    "fresh",
    "large",
    "small",
    "medium",
    "whole",
    "chopped",
    "diced",
    "sliced",
    "minced",
  ];

  for (const adj of adjectivesToRemove) {
    normalized = normalized.replace(new RegExp(`^${adj}\\s+`, "i"), "");
  }

  if (
    normalized.length > 3 &&
    normalized.endsWith("s") &&
    !normalized.endsWith("ss")
  ) {
    const exceptions = ["lentils", "beans", "peas", "oats", "noodles"];
    if (!exceptions.includes(normalized)) {
      normalized = normalized.endsWith("oes")
        ? normalized.slice(0, -2)
        : normalized.slice(0, -1);
    }
  }

  return normalized.trim();
}

export function parseIngredients(
  ingredientTexts: string[],
): ParsedIngredient[] {
  return ingredientTexts.map(parseIngredient);
}

export function formatQuantity(quantity: number | null): string {
  if (!quantity) return "";
  return quantity % 1 === 0
    ? quantity.toString()
    : quantity.toFixed(2).replace(/\.?0+$/, "");
}
