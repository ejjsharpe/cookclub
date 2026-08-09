const UNIT_MAPPINGS: Record<string, string[]> = {
  cup: ["cup", "cups", "c"],
  gallon: ["gallon", "gallons", "gal", "gals"],
  quart: ["quart", "quarts", "qt", "qts"],
  pint: ["pint", "pints", "pt", "pts"],
  tablespoon: ["tablespoon", "tablespoons", "tbsp", "tbs"],
  teaspoon: ["teaspoon", "teaspoons", "tsp", "ts"],
  liter: ["liter", "liters", "litre", "litres", "l"],
  milliliter: ["milliliter", "milliliters", "millilitre", "millilitres", "ml"],
  pound: ["pound", "pounds", "lb", "lbs"],
  ounce: ["ounce", "ounces", "oz"],
  kilogram: ["kilogram", "kilograms", "kg", "kgs"],
  gram: ["gram", "grams", "g", "gm", "gms"],
  milligram: ["milligram", "milligrams", "mg"],
  pinch: ["pinch", "pinches"],
  dash: ["dash", "dashes"],
  clove: ["clove", "cloves"],
  package: ["package", "packages", "pkg", "pkgs"],
  can: ["can", "cans"],
  jar: ["jar", "jars"],
  slice: ["slice", "slices"],
  piece: ["piece", "pieces"],
  whole: ["whole"],
  bunch: ["bunch", "bunches"],
  head: ["head", "heads"],
  stick: ["stick", "sticks"],
};

const CASE_SENSITIVE_MAPPINGS: Record<string, string> = {
  T: "tablespoon",
  t: "teaspoon",
};

const VARIATION_TO_CANONICAL: Record<string, string> = {};

for (const [canonical, variations] of Object.entries(UNIT_MAPPINGS)) {
  for (const variation of variations) {
    VARIATION_TO_CANONICAL[variation.toLowerCase()] = canonical;
  }
}

export function normalizeUnit(input: string | null): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (trimmed in CASE_SENSITIVE_MAPPINGS) {
    return CASE_SENSITIVE_MAPPINGS[trimmed]!;
  }
  const lowercased = trimmed.toLowerCase();
  return VARIATION_TO_CANONICAL[lowercased] || lowercased;
}

export function isRecognizedUnit(unit: string | null): boolean {
  if (!unit) return false;
  const trimmed = unit.trim();
  if (trimmed in CASE_SENSITIVE_MAPPINGS) return true;
  const lowercased = trimmed.toLowerCase();
  return lowercased in VARIATION_TO_CANONICAL;
}

export function getCanonicalUnits(): string[] {
  return Object.keys(UNIT_MAPPINGS);
}

export function getUnitVariations(canonical: string): string[] {
  return UNIT_MAPPINGS[canonical] || [];
}
